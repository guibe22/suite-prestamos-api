import { prisma } from '../../config/database.js';

/**
 * Modelo "Zero-Route": solo ADMIN/SUPER_ADMIN tienen acceso global a toda la
 * organización. Cualquier otro rol (GERENTE, CAJERO, COBRADOR) queda
 * restringido a su(s) ruta(s) asignada(s). Este modelo se documentó y aplicó
 * originalmente solo dentro de `sincronizacion.service.ts` (motor de sync);
 * este módulo lo centraliza para que los endpoints REST directos que borran
 * datos (pago, gasto) también lo respeten, en vez de solo filtrar por
 * organización.
 */
export function esRolRestringidoPorRuta(rol: string): boolean {
  return rol !== 'ADMIN' && rol !== 'SUPER_ADMIN';
}

/**
 * Condición Prisma que matchea una Ruta accesible para `actorId`: ya sea
 * porque es el responsable principal (Ruta.responsableId) o porque figura
 * como colaborador adicional (RutaColaborador). Desde que una ruta admite
 * varios cobradores, todo chequeo de "es la ruta de este actor" debe usar
 * este OR en vez de comparar solo responsableId.
 */
export function rutaAccessFilter(actorId: string): any {
  return {
    OR: [
      { responsableId: actorId },
      { colaboradores: { some: { usuarioId: actorId, deletedAt: null } } },
    ],
  };
}

/**
 * Ids de las rutas de `organizacionId` accesibles para `actorId` (como
 * responsable o colaborador). Útil para restringir registros que no cuelgan
 * directamente de una Ruta (ej. Gasto, que solo referencia una Caja/Usuario)
 * pero cuyo dueño sí pertenece a una ruta.
 */
export async function rutaIdsAccesibles(actorId: string, organizacionId: string): Promise<string[]> {
  const rutas = await prisma.ruta.findMany({
    where: { organizacionId, ...rutaAccessFilter(actorId) },
    select: { id: true },
  });
  return rutas.map((r) => r.id);
}

/**
 * Condición Prisma que matchea un Usuario que pertenece (como responsable o
 * colaborador) a alguna de las rutas dadas.
 */
export function usuarioEnRutasFilter(rutaIds: string[]): any {
  return {
    OR: [
      { rutas: { some: { id: { in: rutaIds } } } },
      { rutasColaborador: { some: { rutaId: { in: rutaIds }, deletedAt: null } } },
    ],
  };
}
