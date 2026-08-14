import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';
import { esRolRestringidoPorRuta, rutaAccessFilter } from '../../shared/access/ruta-scope.js';
import { calcularCargoMora } from '../../workers/mora-recalc.worker.js';

export class PagoService {
  /**
   * Elimina (borrado lógico) un pago y recalcula desde cero las cuotas y el
   * estado del préstamo afectado, usando únicamente los pagos que quedan
   * vigentes. Evita que un préstamo quede marcado como pagado/liquidado con
   * dinero que ya no está contabilizado.
   */
  async eliminar(organizacionId: string, id: string, actorId: string, actorRol: string): Promise<void> {
    // Modelo Zero-Route: GERENTE/CAJERO/COBRADOR solo pueden borrar pagos de
    // préstamos de clientes en una ruta que administran. Sin este scope, un
    // GERENTE de la Ruta A podía borrar pagos de la Ruta B de su misma
    // organización a través de este endpoint (el filtro de ruta solo existía
    // en el motor de sincronización, no aquí).
    const scopeRuta = esRolRestringidoPorRuta(actorRol) ? { ruta: rutaAccessFilter(actorId) } : {};
    const pago = await prisma.pago.findFirst({
      where: { id, prestamo: { cliente: { organizacionId, ...scopeRuta } } },
      include: { prestamo: { select: { clienteId: true } } },
    });
    if (!pago) {
      throw new NotFoundError('El pago no existe en tu organización.');
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.pago.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: actorId },
      });

      // El DELETE directo (el que realmente usa la app) no dejaba rastro en
      // Auditoria; solo el camino de sync lo hacía. Se captura el estado
      // previo al borrado (`pago`, leído antes del update de arriba).
      await tx.auditoria.create({
        data: {
          usuarioId: actorId,
          accion: 'DELETE',
          tabla: 'pagos',
          registroId: pago.id,
          valoresAnteriores: JSON.parse(JSON.stringify(pago)),
        },
      });

      await this.recalcularPrestamo(tx, pago.prestamoId, pago);
      if (pago.jornadaId) {
        await this.recalcularEfectivoCobradoJornada(tx, pago.jornadaId);
        await this.recalcularClientesVisitadosJornada(tx, pago.jornadaId, pago.prestamo.clienteId);
      }
    });
  }

  /**
   * Permite al administrador forzar un recálculo/reparación de un préstamo
   * especificando opcionalmente el número de cuotas que nacieron pagadas de inicio.
   *
   * `actorId`/`actorRol` quedan opcionales porque el panel de plataforma
   * (`admin-organizacion.service.ts`, gateado a SUPER_ADMIN globalmente) llama
   * este método sin contexto de ruta — ahí no aplica el scope Zero-Route.
   */
  async recalcularPrestamoAdmin(
    organizacionId: string,
    prestamoId: string,
    cuotasIniciales?: number,
    actorId?: string,
    actorRol?: string
  ): Promise<void> {
    const scopeRuta = actorId && actorRol && esRolRestringidoPorRuta(actorRol)
      ? { ruta: rutaAccessFilter(actorId) }
      : {};
    const prestamo = await prisma.prestamo.findFirst({
      where: { id: prestamoId, cliente: { organizacionId, ...scopeRuta }, deletedAt: null },
    });
    if (!prestamo) {
      throw new NotFoundError('El préstamo no existe en tu organización.');
    }

    await prisma.$transaction(async (tx: any) => {
      if (typeof cuotasIniciales === 'number' && cuotasIniciales >= 0) {
        const cuotas = await tx.cuota.findMany({
          where: { prestamoId, deletedAt: null },
          orderBy: { numeroCuota: 'asc' },
        });
        for (let i = 0; i < cuotas.length; i++) {
          const c = cuotas[i];
          const yaPagadaInicial = i < cuotasIniciales;
          await tx.cuota.update({
            where: { id: c.id },
            data: {
              montoPagado: yaPagadaInicial ? c.montoTotal : 0,
              estado: yaPagadaInicial ? 'PAGADA' : 'PENDIENTE',
              fechaPago: yaPagadaInicial ? c.fechaVencimiento : null,
            },
          });
        }
      }

      await this.recalcularPrestamo(tx, prestamoId);
    });
  }

  /**
   * JornadaCobranza.efectivoCobrado se escribe desde el cliente al crear el
   * pago; si el pago se borra después de que la jornada cerró, nadie más
   * vuelve a tocar ese total. Se recalcula desde cero con los pagos vigentes
   * de la jornada para que el cuadre no quede inflado para siempre.
   */
  async recalcularEfectivoCobradoJornada(tx: any, jornadaId: string): Promise<void> {
    const pagosVigentes = await tx.pago.findMany({
      where: { jornadaId, deletedAt: null },
    });
    const efectivoCobrado = pagosVigentes.reduce(
      (sum: number, p: any) => sum + Number(p.monto) + Number(p.moraCobrada ?? 0),
      0
    );
    await tx.jornadaCobranza.update({
      where: { id: jornadaId },
      data: { efectivoCobrado },
    });
  }

  /**
   * JornadaCobranza.clientesVisitados/clientesPendientes se incrementan/decrementan
   * desde el cliente al registrar el primer cobro del día a un cliente; si ese
   * pago (el único del cliente en la jornada) se borra después, esos contadores
   * quedaban desincronizados para siempre. Si el cliente ya no tiene ningún pago
   * vigente en la jornada, se revierte el conteo.
   */
  async recalcularClientesVisitadosJornada(tx: any, jornadaId: string, clienteId: string): Promise<void> {
    const otroPagoDelCliente = await tx.pago.findFirst({
      where: { jornadaId, deletedAt: null, prestamo: { clienteId } },
    });
    if (otroPagoDelCliente) return;

    const jornada = await tx.jornadaCobranza.findUnique({ where: { id: jornadaId } });
    if (!jornada) return;

    await tx.jornadaCobranza.update({
      where: { id: jornadaId },
      data: {
        clientesVisitados: Math.max(0, jornada.clientesVisitados - 1),
        clientesPendientes: jornada.clientesPendientes + 1,
      },
    });
  }

  /**
   * Reinicia las cuotas del préstamo y redistribuye los pagos vigentes en
   * orden cronológico, preservando la base de cuotas pagadas de inicio (si el
   * préstamo nació con cuotas pre-pagadas) y recalculando desde cero la mora
   * de las cuotas que queden PENDIENTE.
   */
  async recalcularPrestamo(tx: any, prestamoId: string, pagoEliminado?: any): Promise<void> {
    const prestamo = await tx.prestamo.findUnique({
      where: { id: prestamoId },
      include: { cliente: { include: { organizacion: { select: { configuracion: true } } } } },
    });
    if (!prestamo) return;

    const cuotas = await tx.cuota.findMany({
      where: { prestamoId, deletedAt: null },
      orderBy: { numeroCuota: 'asc' },
    });

    const pagosVigentes = await tx.pago.findMany({
      where: { prestamoId, deletedAt: null },
      orderBy: { fechaPago: 'asc' },
    });

    // 1. Preservar cuotas que nacieron pagadas de inicio (creadas como PAGADA sin fila en la tabla Pago).
    // Ojo: NO se puede recomputar esta base consultando "todos los pagos históricos" (incluidos los
    // eliminados en eventos anteriores), porque `cuotas.montoPagado` ya excluye esos pagos desde el
    // recálculo previo — volver a restarlos aquí los descuenta dos veces y subestima montoInicialPagado
    // en préstamos con más de una eliminación en su historial. El único pago histórico que todavía no
    // está reflejado como excluido en `cuotas` es el que se está eliminando en este mismo evento
    // (`pagoEliminado`), así que se suma explícitamente en vez de volver a consultar la tabla completa.
    const totalCuotasMontoPagadoActual = cuotas.reduce(
      (sum: number, c: any) => sum + Number(c.montoPagado || 0),
      0
    );
    const totalMontoPagosVigentesMasEliminado =
      pagosVigentes.reduce((sum: number, p: any) => sum + Number(p.monto || 0), 0) +
      Number(pagoEliminado?.monto ?? 0);
    const montoInicialPagado = Math.max(
      0,
      totalCuotasMontoPagadoActual - totalMontoPagosVigentesMasEliminado
    );

    const cuotasCalculadas = cuotas.map((c: any) => ({
      id: c.id,
      montoTotal: Number(c.montoTotal),
      montoPagado: 0,
    }));

    let cuotaIndex = 0;

    // Aplicar primero la base de cuotas pagadas de inicio
    let restanteInicial = montoInicialPagado;
    while (restanteInicial > 0 && cuotaIndex < cuotasCalculadas.length) {
      const cuota = cuotasCalculadas[cuotaIndex];
      const pendiente = cuota.montoTotal - cuota.montoPagado;
      if (pendiente <= 0.05) {
        cuotaIndex++;
        continue;
      }
      const aplicar = Math.min(restanteInicial, pendiente);
      cuota.montoPagado += aplicar;
      restanteInicial -= aplicar;
      if (cuota.montoTotal - cuota.montoPagado <= 0.05) {
        cuotaIndex++;
      }
    }

    // Aplicar luego los pagos vigentes cronológicamente
    for (const pago of pagosVigentes) {
      let restante = Number(pago.monto);
      while (restante > 0 && cuotaIndex < cuotasCalculadas.length) {
        const cuota = cuotasCalculadas[cuotaIndex];
        const pendiente = cuota.montoTotal - cuota.montoPagado;
        if (pendiente <= 0.05) {
          cuotaIndex++;
          continue;
        }
        const aplicar = Math.min(restante, pendiente);
        cuota.montoPagado += aplicar;
        restante -= aplicar;
        if (cuota.montoTotal - cuota.montoPagado <= 0.05) {
          cuotaIndex++;
        }
      }
    }

    // 'PAGADA'/'LIQUIDADO': escribir el valor usado por el app móvil
    const cuotasPorId = new Map<string, any>(cuotas.map((c: any) => [c.id, c]));
    for (const cuota of cuotasCalculadas) {
      const pagada = cuota.montoTotal - cuota.montoPagado <= 0.05;
      const original = cuotasPorId.get(cuota.id);
      // Si la cuota ya estaba PAGADA antes de este recálculo y lo sigue estando,
      // se conserva su fechaPago original en vez de pisarla con la fecha de hoy
      // (esto pasa en cada eliminación de pago del préstamo, no solo en la cuota afectada).
      const fechaPago = pagada
        ? original?.estado === 'PAGADA' && original?.fechaPago
          ? original.fechaPago
          : new Date()
        : null;
      await tx.cuota.update({
        where: { id: cuota.id },
        data: {
          montoPagado: cuota.montoPagado,
          estado: pagada ? 'PAGADA' : 'PENDIENTE',
          fechaPago,
        },
      });
    }

    const totalLoanValue = Number(prestamo.monto) + Number(prestamo.monto) * (Number(prestamo.tasaInteres) / 100);
    const totalPagado = montoInicialPagado + pagosVigentes.reduce((sum: number, p: any) => sum + Number(p.monto), 0);
    const liquidado = totalLoanValue - totalPagado <= 0.05;

    // Recalcular la mora desde cero sobre las cuotas que quedan PENDIENTE tras
    // este borrado, en vez de "restituir" sumando `pagoEliminado.moraCobrada`
    // sobre el valor actual. La suma parecía correcta pero no lo era: al
    // resetear `moraFechaCalculo` a null, el worker nocturno (mora-recalc.worker.ts)
    // trata el préstamo como si "nunca hubiera devengado" y le vuelve a cobrar
    // TODO el atraso desde el vencimiento de la cuota hasta hoy, sumándolo
    // (increment) sobre lo ya restituido — duplicando la mora del período que
    // ya se había cubierto. Recalcular aquí con la misma fórmula que usa el
    // worker para un préstamo nuevo (`diasDesdeUltimoCargo = Infinity`) da el
    // valor correcto de una sola vez, y fijar `moraFechaCalculo` a ahora evita
    // que el worker lo vuelva a recomputar desde el vencimiento.
    const finanzas = (prestamo as any)?.cliente?.organizacion?.configuracion?.finanzas;
    const cuotasPendientesParaMora = cuotasCalculadas
      .filter((c: any) => c.montoTotal - c.montoPagado > 0.05)
      .map((c: any) => {
        const fechaVencimiento = cuotasPorId.get(c.id)?.fechaVencimiento;
        return fechaVencimiento ? { fechaVencimiento, montoTotal: c.montoTotal, montoPagado: c.montoPagado } : null;
      })
      .filter((c: any): c is { fechaVencimiento: Date; montoTotal: number; montoPagado: number } => !!c);
    const nuevaMoraAcumulada = finanzas?.tasaMora
      ? calcularCargoMora(cuotasPendientesParaMora, finanzas, Infinity)
      : 0;

    // CANCELADO es un estado terminal manual (ej. refinanciación) distinto de
    // LIQUIDADO; el préstamo conserva su historial de pagos, así que sin esta
    // guarda, borrar cualquiera de esos pagos lo reactivaba a ACTIVO/LIQUIDADO.
    const estado = prestamo.estado === 'CANCELADO' ? 'CANCELADO' : (liquidado ? 'LIQUIDADO' : 'ACTIVO');

    await tx.prestamo.update({
      where: { id: prestamoId },
      data: {
        estado,
        moraAcumulada: nuevaMoraAcumulada,
        moraFechaCalculo: new Date(),
      },
    });
  }
}
