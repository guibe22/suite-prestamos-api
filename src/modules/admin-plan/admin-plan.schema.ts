import { z } from 'zod';

const limitesSchema = z.object({
  maxUsuarios: z.number().int().positive().nullable(),
  maxClientes: z.number().int().positive().nullable(),
  maxPrestamosActivos: z.number().int().positive().nullable(),
  maxRutas: z.number().int().positive().nullable(),
  reportesAvanzados: z.boolean(),
  contratoPersonalizado: z.boolean(),
  soportePrioritario: z.boolean(),
});

export const crearPlanSchema = z.object({
  codigo: z
    .string()
    .min(1, 'El código es requerido.')
    .transform((v) => v.trim().toUpperCase()),
  nombre: z.string().min(1, 'El nombre es requerido.'),
  descripcion: z.string().optional(),
  precioMensual: z.number().nonnegative('El precio no puede ser negativo.'),
  moneda: z.string().min(1).default('USD'),
  limites: limitesSchema,
  esPredeterminado: z.boolean().default(false),
  activo: z.boolean().default(false),
  orden: z.number().int().default(0),
});

export const actualizarPlanSchema = crearPlanSchema.partial();

export const idParamSchema = z.object({
  id: z.string().uuid('El id no es válido.'),
});
