import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';

export class GastoService {
  async eliminar(organizacionId: string, id: string, actorId: string): Promise<void> {
    const gasto = await prisma.gasto.findFirst({
      where: { id, caja: { organizacionId } },
    });
    if (!gasto) {
      throw new NotFoundError('El gasto no existe en tu organización.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.gasto.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: actorId },
      });

      if (gasto.jornadaId) {
        await this.recalcularGastosJornada(tx, gasto.jornadaId);
      }
    });
  }

  /**
   * JornadaCobranza.gastos se escribe desde el cliente al crear el gasto; si
   * se borra después de que la jornada cerró, nadie más vuelve a tocar ese
   * total. Se recalcula desde cero con los gastos vigentes de la jornada.
   */
  private async recalcularGastosJornada(tx: any, jornadaId: string): Promise<void> {
    const gastosVigentes = await tx.gasto.findMany({
      where: { jornadaId, deletedAt: null },
    });
    const gastos = gastosVigentes.reduce((sum: number, g: any) => sum + Number(g.monto), 0);
    await tx.jornadaCobranza.update({
      where: { id: jornadaId },
      data: { gastos },
    });
  }
}
