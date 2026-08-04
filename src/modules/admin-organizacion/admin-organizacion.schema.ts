import { z } from 'zod';

export const listarOrganizacionesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().optional().default(10),
  search: z.string().optional(),
  estado: z.string().optional(),
  planId: z.string().optional(),
});

export const actualizarSuscripcionOrgSchema = z.object({
  planId: z.string().uuid('El id del plan no es válido.'),
  proveedor: z.enum(['REVENUE_CAT', 'MANUAL']),
  estado: z.enum(['TRIAL', 'ACTIVA', 'PENDIENTE_PAGO', 'SUSPENDIDA', 'CANCELADA', 'EXPIRADA']),
  trialTerminaEn: z.string().datetime().nullable().optional(),
  periodoFinEn: z.string().datetime().nullable().optional(),
  canceladaEn: z.string().datetime().nullable().optional(),
  // Solo relevantes con proveedor MANUAL (pago en efectivo) — ver Suscripcion en schema.prisma.
  avisoDias: z.number().int().min(0).nullable().optional(),
  diasGraciaSuspension: z.number().int().min(0).nullable().optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid('El id no es válido.'),
});

// El id de la jornada NO se valida como uuid: las jornadas nacen en la app
// offline-first y WatermelonDB genera ids cortos propios (ej. "au9eiEZY..."),
// no uuid v4.
export const jornadaParamsSchema = z.object({
  id: z.string().uuid('El id de la organización no es válido.'),
  jornadaId: z.string().min(1, 'El id de la jornada es obligatorio.'),
});
