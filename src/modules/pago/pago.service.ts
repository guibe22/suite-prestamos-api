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

    await prisma.$transaction(async (tx) => {
      await tx.pago.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: actorId },
      });

      await this.recalcularPrestamo(tx, pago.prestamoId);
    });
  }

  /**
   * Reinicia las cuotas del préstamo y redistribuye los pagos vigentes en
   * orden cronológico, con el mismo criterio secuencial (cuota más antigua
   * primero) que usa la app al registrar un cobro. Así el resultado es
   * correcto sin importar cuál pago se elimine.
   */
  private async recalcularPrestamo(tx: any, prestamoId: string): Promise<void> {
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

    const cuotasCalculadas = cuotas.map((c: any) => ({
      id: c.id,
      montoTotal: Number(c.montoTotal),
      montoPagado: 0,
    }));

    let cuotaIndex = 0;
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

    for (const cuota of cuotasCalculadas) {
      const pagada = cuota.montoTotal - cuota.montoPagado <= 0.05;
      await tx.cuota.update({
        where: { id: cuota.id },
        data: {
          montoPagado: cuota.montoPagado,
          estado: pagada ? 'PAGADA' : 'PENDIENTE',
          fechaPago: pagada ? new Date() : null,
        },
      });
    }

    const totalLoanValue = Number(prestamo.monto) + Number(prestamo.monto) * (Number(prestamo.tasaInteres) / 100);
    const totalPagado = pagosVigentes.reduce((sum: number, p: any) => sum + Number(p.monto), 0);
    const liquidado = totalLoanValue - totalPagado <= 0.05;

    if (liquidado && prestamo.estado !== 'LIQUIDADO') {
      await tx.prestamo.update({ where: { id: prestamoId }, data: { estado: 'LIQUIDADO' } });
    } else if (!liquidado && prestamo.estado === 'LIQUIDADO') {
      await tx.prestamo.update({ where: { id: prestamoId }, data: { estado: 'ACTIVO' } });
    }
  }
}
