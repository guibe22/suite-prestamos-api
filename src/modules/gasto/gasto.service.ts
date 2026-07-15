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

    await prisma.gasto.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: actorId },
    });
  }
}
