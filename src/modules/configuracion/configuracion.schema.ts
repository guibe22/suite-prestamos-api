import { z } from 'zod';

export const actualizarConfiguracionSchema = z.object({
  suscripcionesEnforcementEnabled: z.boolean().optional(),
  // "1.2.0" o null para quitar el mínimo. Formato semver simple (no
  // pre-releases) — basta para comparar contra Constants.expoConfig.version.
  minVersionApp: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Debe tener el formato X.Y.Z, ej. 1.2.0')
    .nullable()
    .optional(),
  suscripcionGraciaDias: z.number().int().min(0).max(90).optional(),
  soporteTelefono: z.string().trim().min(1).nullable().optional(),
  soporteEmail: z.string().trim().email('Debe ser un correo válido').nullable().optional(),
});
