import { z } from 'zod';

export const actualizarConfiguracionSchema = z.object({
  suscripcionesEnforcementEnabled: z.boolean(),
});
