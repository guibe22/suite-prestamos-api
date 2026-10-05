import { z } from 'zod';

export const enviarAnuncioSchema = z.object({
  /** Null o ausente = todas las organizaciones vigentes. */
  organizacionId: z.string().min(1).nullable().optional(),
  categoria: z.enum(['COBRANZA', 'JORNADA', 'EQUIPO', 'SUSCRIPCION', 'SINCRONIZACION']),
  titulo: z.string().trim().min(3, 'El título es muy corto.').max(80, 'El título no puede pasar de 80 caracteres.'),
  // 200 caracteres es lo que Android alcanza a mostrar expandido; más allá se
  // corta y el usuario nunca ve el final.
  cuerpo: z.string().trim().min(5, 'El mensaje es muy corto.').max(200, 'El mensaje no puede pasar de 200 caracteres.'),
  /** Solo rutas internas: el deep link no debe poder sacar al usuario de la app. */
  ruta: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9\-_/()[\]]*$/, 'La ruta debe ser interna y empezar con "/".')
    .max(120)
    .optional(),
});

export const diagnosticoQuerySchema = z.object({
  dias: z.coerce.number().int().min(1).max(90).optional(),
});
