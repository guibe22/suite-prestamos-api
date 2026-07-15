import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Envía un correo vía la API HTTP de Resend. En desarrollo sin RESEND_API_KEY,
 * el contenido queda solo en el log del servidor y no se lanza error (para no
 * bloquear flujos locales); en producción la ausencia de la clave sí falla.
 */
export async function sendEmail(params: { to: string; subject: string; html: string; devLogFallback: string }): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    if (env.NODE_ENV !== 'production') {
      logger.warn(`⚠️  RESEND_API_KEY no configurada.`);
      logger.warn(`🔑 [SOLO DESARROLLO] ${params.devLogFallback}`);
      return;
    }
    throw new Error('El servicio de correo no está configurado (RESEND_API_KEY).');
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!response.ok) {
      const errJson = (await response.json().catch(() => ({}))) as any;
      console.error('Error de la API de Resend:', errJson);
      throw new Error(errJson.message || `Error del servidor de correos (${response.status})`);
    }
  } catch (error: any) {
    // El dominio sandbox de Resend (onboarding@resend.dev) solo permite enviar
    // al correo del dueño de la cuenta. En desarrollo no bloqueamos el flujo:
    // el contenido queda en la consola del servidor y el flujo continúa.
    if (env.NODE_ENV !== 'production') {
      logger.warn(`⚠️  No se pudo enviar el correo a ${params.to}: ${error.message}`);
      logger.warn(`🔑 [SOLO DESARROLLO] ${params.devLogFallback}`);
      return;
    }
    console.error('Fallo al enviar correo con Resend:', error);
    throw new Error(`No se pudo enviar el correo: ${error.message}`);
  }
}
