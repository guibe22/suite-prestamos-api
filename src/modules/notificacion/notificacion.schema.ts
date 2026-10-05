import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().min(1, 'El id no es válido.'),
});

/**
 * El formato del token lo fija Expo. Validarlo acá evita guardar basura que
 * después haría fallar un lote entero de envíos.
 */
export const registrarDispositivoSchema = z.object({
  token: z
    .string()
    .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'El token de push no tiene un formato válido.'),
  plataforma: z.enum(['android', 'ios']),
  appVersion: z.string().max(32).optional(),
});

export const bajaDispositivoSchema = z.object({
  token: z.string().min(1, 'El token es obligatorio.'),
});

export const listarQuerySchema = z.object({
  limite: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).optional(),
});

/**
 * Todas opcionales: la pantalla de ajustes manda solo el switch que cambió.
 * `.strict()` para que un campo mal escrito falle en vez de ignorarse en
 * silencio y dejar al usuario creyendo que guardó algo.
 *
 * El caso "no mandaron ninguna" se valida en el controller, no acá: un
 * `.refine()` convertiría el esquema en ZodEffects y `validate` espera un
 * ZodObject.
 */
export const preferenciasSchema = z
  .object({
    cobranza: z.boolean().optional(),
    jornada: z.boolean().optional(),
    equipo: z.boolean().optional(),
    suscripcion: z.boolean().optional(),
    sincronizacion: z.boolean().optional(),
    sonido: z.boolean().optional(),
    vibracion: z.boolean().optional(),
  })
  .strict();
