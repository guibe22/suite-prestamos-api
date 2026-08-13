import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';

export class PagoService {
  /**
   * Elimina (borrado lógico) un pago y recalcula desde cero las cuotas y el
   * estado del préstamo afectado, usando únicamente los pagos que quedan
   * vigentes. Evita que un préstamo quede marcado como pagado/liquidado con
   * dinero que ya no está contabilizado.
   */
  async eliminar(organizacionId: string, id: string, actorId: string): Promise<void> {
    const pago = await prisma.pago.findFirst({
      where: { id, prestamo: { cliente: { organizacionId } } },
    });
    if (!pago) {
      throw new NotFoundError('El pago no existe en tu organización.');
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.pago.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: actorId },
      });

      await this.recalcularPrestamo(tx, pago.prestamoId, pago);
      if (pago.jornadaId) {
        await this.recalcularEfectivoCobradoJornada(tx, pago.jornadaId);
      }
    });
  /**
   * Permite al administrador forzar un recálculo/reparación de un préstamo
   * especificando opcionalmente el número de cuotas que nacieron pagadas de inicio.
   */
  async recalcularPrestamoAdmin(
    organizacionId: string,
    prestamoId: string,
    cuotasIniciales?: number
  ): Promise<void> {
    const prestamo = await prisma.prestamo.findFirst({
      where: { id: prestamoId, cliente: { organizacionId }, deletedAt: null },
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
   * Reinicia las cuotas del préstamo y redistribuye los pagos vigentes en
   * orden cronológico, preservando la base de cuotas pagadas de inicio (si el
   * préstamo nació con cuotas pre-pagadas) y restituyendo la mora cobrada
   * del pago eliminado.
   */
  async recalcularPrestamo(tx: any, prestamoId: string, pagoEliminado?: any): Promise<void> {
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

    // 1. Preservar cuotas que nacieron pagadas de inicio (creadas como PAGADA sin fila en la tabla Pago)
    const totalCuotasMontoPagadoActual = cuotas.reduce(
      (sum: number, c: any) => sum + Number(c.montoPagado || 0),
      0
    );
    const todosLosPagosHistoricos = await tx.pago.findMany({
      where: { prestamoId },
    });
    const totalMontoPagosHistoricos = todosLosPagosHistoricos.reduce(
      (sum: number, p: any) => sum + Number(p.monto || 0),
      0
    );
    const montoInicialPagado = Math.max(0, totalCuotasMontoPagadoActual - totalMontoPagosHistoricos);

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
    for (const cuota of cuotasCalculadas) {
      const pagada = cuota.montoTotal - cuota.montoPagado <= 0.05;
      await tx.cuota.update({
        where: { id: cuota.id },
        data: {
          montoPagado: cuota.montoPagado,
          estado: pagada ? 'PAGADA' : 'PENDIENTE',
          fechaPago: pagada ? (cuota.montoPagado > 0 ? new Date() : null) : null,
        },
      });
    }

    const totalLoanValue = Number(prestamo.monto) + Number(prestamo.monto) * (Number(prestamo.tasaInteres) / 100);
    const totalPagado = montoInicialPagado + pagosVigentes.reduce((sum: number, p: any) => sum + Number(p.monto), 0);
    const liquidado = totalLoanValue - totalPagado <= 0.05;

    // Restituir mora cobrada si el pago eliminado la tenía, y resetear moraFechaCalculo
    const moraCobradaEliminada = Number(pagoEliminado?.moraCobrada ?? 0);
    const nuevaMoraAcumulada = Math.max(0, Number(prestamo.moraAcumulada || 0) + moraCobradaEliminada);

    await tx.prestamo.update({
      where: { id: prestamoId },
      data: {
        estado: liquidado ? 'LIQUIDADO' : 'ACTIVO',
        moraAcumulada: nuevaMoraAcumulada,
        moraFechaCalculo: null,
      },
    });
  }
}
