import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';
import { esRolRestringidoPorRuta, rutaIdsAccesibles, usuarioEnRutasFilter } from '../../shared/access/ruta-scope.js';

export class GastoService {
  async eliminar(organizacionId: string, id: string, actorId: string, actorRol: string): Promise<void> {
    // Modelo Zero-Route: un GASTO no tiene ruta propia, cuelga de una Caja que
    // pertenece a un usuario (Caja.usuarioId). Para GERENTE/CAJERO/COBRADOR se
    // restringe a gastos de cajas cuyo dueño comparte una ruta con el actor
    // (mismo criterio que ya aplica sincronizacion.service.ts en el push).
    let scopeRuta: any = {};
    if (esRolRestringidoPorRuta(actorRol)) {
      const rutaIds = await rutaIdsAccesibles(actorId, organizacionId);
      scopeRuta = { usuario: usuarioEnRutasFilter(rutaIds) };
    }
    const gasto = await prisma.gasto.findFirst({
      where: { id, caja: { organizacionId, ...scopeRuta } },
    });
    if (!gasto) {
      throw new NotFoundError('El gasto no existe en tu organización.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.gasto.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: actorId },
      });

      // Mismo hueco que tenía Pago: el DELETE directo no dejaba rastro en
      // Auditoria. `gasto` se leyó antes del update de arriba (estado previo).
      await tx.auditoria.create({
        data: {
          usuarioId: actorId,
          accion: 'DELETE',
          tabla: 'gastos',
          registroId: gasto.id,
          valoresAnteriores: JSON.parse(JSON.stringify(gasto)),
        },
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
   *
   * No es `private`: `sincronizacion.service.ts` también la llama al procesar
   * borrados de gastos que llegan por el push offline.
   */
  async recalcularGastosJornada(tx: any, jornadaId: string): Promise<void> {
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
