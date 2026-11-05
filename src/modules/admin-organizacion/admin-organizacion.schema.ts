import { z } from 'zod';

export const listarOrganizacionesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().optional().default(10),
  search: z.string().optional(),
  estado: z.string().optional(),
  planId: z.string().optional(),
  acceso: z.string().optional(),
  actividad: z.string().optional(),
  registro: z.string().optional(),
  ordenarPor: z.string().optional(),
});

export const enviarRecordatorioCorreoSchema = z.object({
  organizacionIds: z
    .array(z.string().uuid('Uno de los IDs de organización no es válido.'))
    .min(1, 'Debes seleccionar al menos una organización.')
    .max(100, 'Solo se permiten hasta 100 organizaciones por envío.'),
  asunto: z.string().trim().min(3, 'El asunto es demasiado corto.').max(160, 'El asunto es demasiado largo.'),
  mensaje: z.string().trim().min(10, 'El mensaje es demasiado corto.').max(4000, 'El mensaje es demasiado largo.'),
  ctaTexto: z.string().trim().max(80).optional(),
  ctaUrl: z.string().trim().url().optional(),
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
  // Límites personalizados definidos por el admin (ej. Plan Empresarial).
  limitesPersonalizados: z
    .object({
      maxUsuarios: z.number().int().min(0).nullable().optional(),
      maxClientes: z.number().int().min(0).nullable().optional(),
      maxPrestamosActivos: z.number().int().min(0).nullable().optional(),
      maxRutas: z.number().int().min(0).nullable().optional(),
    })
    .nullable()
    .optional(),
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

// Los clientes también nacen en la app con ids de WatermelonDB (no uuid).
export const clienteParamsSchema = z.object({
  id: z.string().uuid('El id de la organización no es válido.'),
  clienteId: z.string().min(1, 'El id del cliente es obligatorio.'),
});

export const clientesEliminadosQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});

// Igual que jornadaParamsSchema: los préstamos también tienen ids de WatermelonDB.
export const prestamoParamsSchema = z.object({
  id: z.string().uuid('El id de la organización no es válido.'),
  prestamoId: z.string().min(1, 'El id del préstamo es obligatorio.'),
});
