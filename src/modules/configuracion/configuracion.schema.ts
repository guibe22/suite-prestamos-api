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
});
