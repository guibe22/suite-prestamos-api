import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3020),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Envío de correos (código de verificación). Opcional en desarrollo.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('Suite Préstamos <onboarding@resend.dev>'),
  // Orígenes permitidos para CORS (separados por coma). Requerido en producción.
  CORS_ORIGINS: z.string().optional(),

  // Suscripciones / monetización.
  // El enforcement (bloquear o no según el estado de la suscripción) ya NO
  // vive aquí: es un toggle en la tabla ConfiguracionSistema, editable desde
  // el panel admin sin redeploy (ver modules/configuracion).
  //
  // Secreto configurado al crear el webhook en el dashboard de RevenueCat
  // (Project settings > Integrations > Webhooks) — RevenueCat lo manda en el
  // header Authorization de cada request.
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  // API key pública de Android de RevenueCat. Vive en el servidor (no en
  // EXPO_PUBLIC_*) para que rotarla no requiera un build nuevo de la app: el
  // cliente la pide en caliente vía GET /suscripcion/config.
  REVENUECAT_ANDROID_API_KEY: z.string().optional(),
})
  .refine((e) => e.NODE_ENV !== 'production' || !/change-me/i.test(e.JWT_SECRET), {
    message: 'JWT_SECRET no puede ser el valor placeholder en producción.',
    path: ['JWT_SECRET'],
  });

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Error de validación en variables de entorno:', result.error.format());
    process.exit(1);
  }

  return result.data;
};

export const env = parseEnv();
