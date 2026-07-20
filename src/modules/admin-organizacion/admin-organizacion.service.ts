import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';
import type { actualizarSuscripcionOrgSchema } from './admin-organizacion.schema.js';
import type { z } from 'zod';

type ActualizarSuscripcionInput = z.infer<typeof actualizarSuscripcionOrgSchema>;

/** undefined = no tocar el campo, null = limpiarlo, string = fecha nueva. */
function normalizarFecha(valor?: string | null): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Date(valor);
}

export class AdminOrganizacionService {
  /** Catálogo de organizaciones con su suscripción y uso, para el panel de PLATAFORMA. */
  async listar() {
    const organizaciones = await prisma.organizacion.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        suscripcion: { include: { plan: true } },
        _count: { select: { usuarios: true, clientes: true } },
      },
    });

    return organizaciones.map((org) => ({
      id: org.id,
      nombre: org.nombre,
      createdAt: org.createdAt,
      usuarios: org._count.usuarios,
      clientes: org._count.clientes,
      suscripcion: org.suscripcion
        ? {
            estado: org.suscripcion.estado,
            proveedor: org.suscripcion.proveedor,
            trialTerminaEn: org.suscripcion.trialTerminaEn,
            periodoFinEn: org.suscripcion.periodoFinEn,
            canceladaEn: org.suscripcion.canceladaEn,
            plan: {
              id: org.suscripcion.plan.id,
              codigo: org.suscripcion.plan.codigo,
              nombre: org.suscripcion.plan.nombre,
            },
          }
        : null,
    }));
  }

  /**
   * Alta/edición manual de la suscripción de una organización — para comp de
   * clientes, extender un trial, o corregir un estado que un webhook de
   * RevenueCat no llegó a actualizar. Si la organización todavía no tiene fila
   * de Suscripcion (orgs muy viejas, o el seed no había corrido) la crea.
   *
   * Aviso: si la organización SÍ tiene una suscripción real de RevenueCat, el
   * próximo webhook que llegue puede sobreescribir este ajuste manual.
   */
  async actualizarSuscripcion(organizacionId: string, data: ActualizarSuscripcionInput) {
    const organizacion = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!organizacion) {
      throw new NotFoundError('La organización no existe.');
    }

    const plan = await prisma.plan.findUnique({ where: { id: data.planId } });
    if (!plan) {
      throw new NotFoundError('El plan indicado no existe.');
    }

    const campos = {
      planId: data.planId,
      proveedor: data.proveedor,
      estado: data.estado,
      trialTerminaEn: normalizarFecha(data.trialTerminaEn),
      periodoFinEn: normalizarFecha(data.periodoFinEn),
      canceladaEn: normalizarFecha(data.canceladaEn),
    };

    return prisma.suscripcion.upsert({
      where: { organizacionId },
      update: campos,
      create: { organizacionId, ...campos },
      include: { plan: true },
    });
  }
}
