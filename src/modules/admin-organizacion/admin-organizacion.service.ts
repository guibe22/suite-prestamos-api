import { prisma } from '../../config/database.js';
import { NotFoundError } from '../../shared/errors/custom.error.js';
import { getPagination, getPaginationMeta } from '../../utils/pagination.js';
import type { actualizarSuscripcionOrgSchema, listarOrganizacionesQuerySchema } from './admin-organizacion.schema.js';
import type { z } from 'zod';
import type { EstadoSuscripcion, Prisma } from '@prisma/client';

type ActualizarSuscripcionInput = z.infer<typeof actualizarSuscripcionOrgSchema>;
type ListarOrganizacionesQuery = Partial<z.infer<typeof listarOrganizacionesQuerySchema>>;

/** undefined = no tocar el campo, null = limpiarlo, string = fecha nueva. */
function normalizarFecha(valor?: string | null): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Date(valor);
}

export class AdminOrganizacionService {
  /** Catálogo paginado y filtrado de organizaciones para el panel de PLATAFORMA. */
  async listar(query: ListarOrganizacionesQuery = {}) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    const limit = query.limit && query.limit > 0 ? Number(query.limit) : 10;
    const { skip, take } = getPagination({ page, limit });

    const search = query.search?.trim();
    const estado = query.estado;
    const planId = query.planId;

    const where: Prisma.OrganizacionWhereInput = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { id: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(estado && estado !== 'TODOS'
        ? estado === 'SIN_SUSCRIPCION'
          ? { suscripcion: null }
          : { suscripcion: { estado: estado as EstadoSuscripcion } }
        : {}),
      ...(planId && planId !== 'TODOS'
        ? { suscripcion: { planId } }
        : {}),
    };

    const [totalItems, organizaciones, stats] = await Promise.all([
      prisma.organizacion.count({ where }),
      prisma.organizacion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          suscripcion: { include: { plan: true } },
          _count: { select: { usuarios: true, clientes: true } },
        },
      }),
      this.obtenerEstadisticas(),
    ]);

    const data = organizaciones.map((org) => ({
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
            avisoDias: org.suscripcion.avisoDias,
            diasGraciaSuspension: org.suscripcion.diasGraciaSuspension,
            avisoEnviadoEn: org.suscripcion.avisoEnviadoEn,
            plan: {
              id: org.suscripcion.plan.id,
              codigo: org.suscripcion.plan.codigo,
              nombre: org.suscripcion.plan.nombre,
            },
          }
        : null,
    }));

    const meta = {
      ...getPaginationMeta(page, limit, totalItems),
      stats,
    };

    return { data, meta };
  }

  /** Estadísticas globales para las tarjetas KPI de la cabecera. */
  private async obtenerEstadisticas() {
    const [total, activas, trial, sinSub] = await Promise.all([
      prisma.organizacion.count({ where: { deletedAt: null } }),
      prisma.organizacion.count({ where: { deletedAt: null, suscripcion: { estado: 'ACTIVA' } } }),
      prisma.organizacion.count({ where: { deletedAt: null, suscripcion: { estado: 'TRIAL' } } }),
      prisma.organizacion.count({ where: { deletedAt: null, suscripcion: null } }),
    ]);

    return {
      total,
      activas,
      trial,
      bloqueadas: Math.max(0, total - activas - trial - sinSub),
      sinSub,
    };
  }

  /** Alta/edición manual de la suscripción de una organización. */
  async actualizarSuscripcion(organizacionId: string, data: ActualizarSuscripcionInput) {
    const organizacion = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!organizacion) {
      throw new NotFoundError('La organización no existe.');
    }

    const plan = await prisma.plan.findUnique({ where: { id: data.planId } });
    if (!plan) {
      throw new NotFoundError('El plan indicado no existe.');
    }

    const actual = await prisma.suscripcion.findUnique({ where: { organizacionId } });
    const periodoFinEn = normalizarFecha(data.periodoFinEn);
    const periodoFinEnCambio = periodoFinEn !== undefined && periodoFinEn?.getTime() !== actual?.periodoFinEn?.getTime();

    const campos = {
      planId: data.planId,
      proveedor: data.proveedor,
      estado: data.estado,
      trialTerminaEn: normalizarFecha(data.trialTerminaEn),
      periodoFinEn,
      canceladaEn: normalizarFecha(data.canceladaEn),
      avisoDias: data.avisoDias,
      diasGraciaSuspension: data.diasGraciaSuspension,
      ...(periodoFinEnCambio ? { avisoEnviadoEn: null } : {}),
    };

    return prisma.suscripcion.upsert({
      where: { organizacionId },
      update: campos,
      create: { organizacionId, ...campos },
      include: { plan: true },
    });
  }

  /** Bitácora de auditoría de una organización. */
  async listarAuditoria(organizacionId: string) {
    const organizacion = await prisma.organizacion.findUnique({ where: { id: organizacionId } });
    if (!organizacion) {
      throw new NotFoundError('La organización no existe.');
    }

    return prisma.auditoria.findMany({
      where: { usuario: { organizacionId } },
      include: { usuario: { select: { nombre: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
