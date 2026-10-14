import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';
import { esRolRestringidoPorRuta, rutaAccessFilter } from '../../shared/access/ruta-scope.js';
import { baseInicialImplicita, distribuirEnCuotas, TOLERANCIA_CUOTA_PAGADA } from './redistribucion.js';

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
    // deletedAt: null evita reprocesar un pago ya borrado (doble tap, retry de
    // red tras un timeout): recalcularClientesVisitadosJornada resta relativo
    // al valor actual, así que una segunda ejecución sobre el mismo pago lo
    // desangraba en vez de ser un no-op.
    const pago = await prisma.pago.findFirst({
      where: { id, deletedAt: null, prestamo: { cliente: { organizacionId, ...scopeRuta } } },
      include: { prestamo: { select: { clienteId: true } } },
    });
    if (!pago) {
      throw new NotFoundError('El pago no existe en tu organización.');
    }

    await prisma.$transaction(async (tx: any) => {
      // Condicionado a `deletedAt: null` DENTRO de la transacción: el findFirst
      // de arriba corre fuera de ella, así que dos DELETE simultáneos del mismo
      // pago (doble tap, reintento tras timeout) pasaban ambos y recalculaban
      // dos veces. El segundo ahora es un no-op.
      const { count } = await tx.pago.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), deletedBy: actorId },
      });
      if (count === 0) return;

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
      await this.recalcularPrestamoAdminTx(tx, prestamoId, cuotasIniciales);
    });
  }

  /**
   * Igual que `recalcularPrestamoAdmin` pero dentro de una transacción ya
   * abierta. Existe porque el editor de préstamos del panel admin
   * (admin-organizacion.service.ts) llamaba a `recalcularPrestamoAdmin` DENTRO
   * de su propia transacción: eran dos transacciones sobre la misma fila del
   * préstamo, se esperaban entre sí hasta el timeout y se perdían las
   * ediciones del admin.
   *
   * Con `cuotasIniciales` la base se fija EXPLÍCITAMENTE (Σ montoTotal de las
   * primeras N cuotas). Antes se ponían esas N cuotas en PAGADA y el resto en
   * 0, y luego `recalcularPrestamo` "deducía" la base como Σcuotas − Σpagos:
   * con pagos vigentes eso restaba los pagos de la base y la dejaba en 0.
   */
  async recalcularPrestamoAdminTx(tx: any, prestamoId: string, cuotasIniciales?: number): Promise<void> {
    if (typeof cuotasIniciales === 'number' && cuotasIniciales >= 0) {
      const cuotas = await tx.cuota.findMany({
        where: { prestamoId, deletedAt: null },
        orderBy: { numeroCuota: 'asc' },
      });
      const base = cuotas
        .slice(0, cuotasIniciales)
        .reduce((sum: number, c: any) => sum + Number(c.montoTotal || 0), 0);
      await this.redistribuirCuotas(tx, prestamoId, base);
      return;
    }
    await this.recalcularPrestamo(tx, prestamoId);
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
   * Base de cuotas pagadas de inicio (cuotas creadas PAGADA sin fila en Pago)
   * deducida del estado ACTUAL: Σ cuotas.montoPagado − Σ aplicado por los pagos
   * que ese estado todavía refleja (vigentes + `pagosAunReflejados`, p. ej. el
   * pago que se acaba de borrar). Solo es confiable si las cuotas no fueron
   * pisadas por un dispositivo después del último recálculo — por eso el push
   * de sync la toma ANTES de aplicar los cambios del dispositivo
   * (ver `sincronizacion.service.ts`).
   */
  async calcularBaseInicial(tx: any, prestamoId: string, pagosAunReflejados: any[] = []): Promise<number> {
    const cuotas = await tx.cuota.findMany({ where: { prestamoId, deletedAt: null } });
    const pagosVigentes = await tx.pago.findMany({ where: { prestamoId, deletedAt: null } });
    const idsVigentes = new Set(pagosVigentes.map((p: any) => p.id));
    const reflejados = [...pagosVigentes, ...pagosAunReflejados.filter((p: any) => p && !idsVigentes.has(p.id))];
    return baseInicialImplicita(cuotas, reflejados).base;
  }

  /**
   * Reconstruye `montoPagado`/`estado`/`fechaPago` de TODAS las cuotas del
   * préstamo desde cero: primero la base de cuotas pagadas de inicio y luego
   * los pagos vigentes en orden cronológico. Fija también el estado del
   * préstamo (LIQUIDADO cuando ya no queda ninguna cuota pendiente — antes se
   * decidía con la fórmula monto×(1+tasa), que no coincide con las cuotas si
   * el admin las editó). No toca la mora.
   */
  async redistribuirCuotas(tx: any, prestamoId: string, baseInicial: number): Promise<void> {
    const prestamo = await tx.prestamo.findUnique({ where: { id: prestamoId } });
    if (!prestamo) return;

    const cuotas = await tx.cuota.findMany({
      where: { prestamoId, deletedAt: null },
      orderBy: { numeroCuota: 'asc' },
    });
    const pagosVigentes = await tx.pago.findMany({
      where: { prestamoId, deletedAt: null },
      orderBy: { fechaPago: 'asc' },
    });

    // Primero la base de cuotas pagadas de inicio, luego los pagos vigentes
    // en orden cronológico (el excedente de un sobrepago se descarta al
    // acabarse las cuotas). Ver modules/pago/redistribucion.ts.
    const montosPagados = distribuirEnCuotas(
      cuotas.map((c: any) => Number(c.montoTotal)),
      [Math.max(0, baseInicial), ...pagosVigentes.map((p: any) => Number(p.monto))]
    );
    const cuotasCalculadas = cuotas.map((c: any, idx: number) => ({
      id: c.id,
      montoTotal: Number(c.montoTotal),
      montoPagado: montosPagados[idx],
    }));

    // 'PAGADA'/'LIQUIDADO': escribir el valor usado por el app móvil
    const cuotasPorId = new Map<string, any>(cuotas.map((c: any) => [c.id, c]));
    let quedaPendiente = false;
    for (const cuota of cuotasCalculadas) {
      const pagada = cuota.montoTotal - cuota.montoPagado <= TOLERANCIA_CUOTA_PAGADA;
      if (!pagada) quedaPendiente = true;
      const original = cuotasPorId.get(cuota.id);
      // Si la cuota ya estaba PAGADA antes de este recálculo y lo sigue estando,
      // se conserva su fechaPago original en vez de pisarla con la fecha de hoy
      // (esto pasa en cada eliminación de pago del préstamo, no solo en la cuota afectada).
      const fechaPago = pagada
        ? original?.estado === 'PAGADA' && original?.fechaPago
          ? original.fechaPago
          : new Date()
        : null;
      const estadoCuota = pagada ? 'PAGADA' : 'PENDIENTE';
      // Solo se escribe lo que cambió: el push de sync llama esto en CADA
      // cobro, y reescribir todas las cuotas del préstamo les subía el
      // updatedAt y obligaba a todos los dispositivos a volver a bajarlas.
      const sinCambios =
        original &&
        Math.abs(Number(original.montoPagado || 0) - cuota.montoPagado) < 0.005 &&
        original.estado === estadoCuota &&
        (pagada ? !!original.fechaPago : !original.fechaPago);
      if (sinCambios) continue;
      await tx.cuota.update({
        where: { id: cuota.id },
        data: {
          montoPagado: cuota.montoPagado,
          estado: estadoCuota,
          fechaPago,
        },
      });
    }

    const liquidado = cuotasCalculadas.length > 0
      ? !quedaPendiente
      : Number(prestamo.monto) * (1 + Number(prestamo.tasaInteres) / 100) -
          pagosVigentes.reduce((sum: number, p: any) => sum + Number(p.monto), 0) <= 0.05;

    // CANCELADO es un estado terminal manual (ej. refinanciación) distinto de
    // LIQUIDADO; el préstamo conserva su historial de pagos, así que sin esta
    // guarda, borrar cualquiera de esos pagos lo reactivaba a ACTIVO/LIQUIDADO.
    const estado = prestamo.estado === 'CANCELADO' ? 'CANCELADO' : (liquidado ? 'LIQUIDADO' : 'ACTIVO');
    if (estado !== prestamo.estado) {
      await tx.prestamo.update({ where: { id: prestamoId }, data: { estado } });
    }
  }

  /**
   * Reinicia las cuotas del préstamo y redistribuye los pagos vigentes en
   * orden cronológico, preservando la base de cuotas pagadas de inicio, y
   * restituye la mora del pago eliminado (si lo hay).
   */
  async recalcularPrestamo(tx: any, prestamoId: string, pagoEliminado?: any): Promise<void> {
    const prestamo = await tx.prestamo.findUnique({ where: { id: prestamoId } });
    if (!prestamo) return;

    // El pago que se está eliminando ya tiene deletedAt, pero las cuotas
    // todavía reflejan su aplicación: se cuenta como "aún reflejado" para que
    // la base no lo confunda con dinero pagado de inicio.
    const base = await this.calcularBaseInicial(tx, prestamoId, pagoEliminado ? [pagoEliminado] : []);
    await this.redistribuirCuotas(tx, prestamoId, base);

    // Mora: se RESTITUYE solo la mora que había cobrado el pago eliminado,
    // sobre el valor actual (mismo criterio que `eliminarPagoLocal` en la app).
    //
    // Antes, con tasaMora configurada, se recalculaba desde cero
    // (`calcularCargoMora(..., Infinity)`: saldo pendiente × todos los días
    // desde el vencimiento) y se REEMPLAZABA moraAcumulada. Eso ignoraba la
    // mora ya cobrada por los pagos que siguen vigentes y las exoneraciones
    // del admin: borrar cualquier pago (aunque no tuviera mora) volvía a
    // cargarle al cliente mora que ya había pagado o que se le había perdonado.
    //
    // La duplicación que motivó aquel recálculo venía de dejar
    // `moraFechaCalculo` en null (el worker devengaba otra vez todo el atraso
    // desde el vencimiento). Fijarlo a ahora —abajo— basta para evitarla: el
    // worker solo suma los días posteriores (`diasPendientesDeDevengo`).
    const moraRevertida = Number(pagoEliminado?.moraCobrada || 0);
    const moraActual = Number(prestamo.moraAcumulada || 0);
    const nuevaMoraAcumulada = Math.max(0, moraActual + moraRevertida);

    await tx.prestamo.update({
      where: { id: prestamoId },
      data: {
        moraAcumulada: nuevaMoraAcumulada,
        moraFechaCalculo: new Date(),
      },
    });
  }
}
