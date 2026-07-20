import { z } from 'zod';

export const actualizarSuscripcionOrgSchema = z.object({
  planId: z.string().uuid('El id del plan no es válido.'),
  proveedor: z.enum(['REVENUE_CAT', 'MANUAL']),
  estado: z.enum(['TRIAL', 'ACTIVA', 'PENDIENTE_PAGO', 'SUSPENDIDA', 'CANCELADA', 'EXPIRADA']),
  trialTerminaEn: z.string().datetime().nullable().optional(),
  periodoFinEn: z.string().datetime().nullable().optional(),
  canceladaEn: z.string().datetime().nullable().optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid('El id no es válido.'),
});
