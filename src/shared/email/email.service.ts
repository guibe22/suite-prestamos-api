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
      logger.warn('⚠️  RESEND_API_KEY no configurada.');
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

/**
 * Envía un lote de correos personalizados usando el endpoint batch de Resend
 * (`POST https://api.resend.com/emails/batch`, hasta 100 correos por petición).
 * Si el endpoint batch falla en un bloque, reintenta en paralelo controlado
 * para no perder entregas válidas.
 */
export async function sendBatchEmails(
  items: Array<{ to: string; subject: string; html: string; devLogFallback: string }>
): Promise<{ enviados: number; fallidos: number; destinatarios: string[] }> {
  if (items.length === 0) {
    return { enviados: 0, fallidos: 0, destinatarios: [] };
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    if (env.NODE_ENV !== 'production') {
      logger.warn(`⚠️  RESEND_API_KEY no configurada. Simulando lote de ${items.length} correo(s).`);
      for (const item of items) {
        logger.warn(`🔑 [SOLO DESARROLLO LOTE] ${item.devLogFallback}`);
      }
      return {
        enviados: items.length,
        fallidos: 0,
        destinatarios: items.map((i) => i.to),
      };
    }
    throw new Error('El servicio de correo no está configurado (RESEND_API_KEY).');
  }

  const BATCH_SIZE = 100;
  let enviados = 0;
  let fallidos = 0;
  const destinatarios: string[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const lote = items.slice(i, i + BATCH_SIZE);

    try {
      const response = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
          lote.map((item) => ({
            from: env.RESEND_FROM,
            to: [item.to],
            subject: item.subject,
            html: item.html,
          }))
        ),
      });

      if (response.ok) {
        enviados += lote.length;
        for (const item of lote) {
          destinatarios.push(item.to);
        }
        continue;
      }

      // Si el batch entero fue rechazado (ej. un correo mal formado), hacemos fallback en sub-lotes paralelos de 10
      const errText = await response.text().catch(() => '');
      logger.warn(`⚠️  Resend batch respondió ${response.status} (${errText}). Aplicando fallback por sub-lotes...`);
    } catch (err: any) {
      logger.warn(`⚠️  Error en petición Resend batch (${err?.message}). Aplicando fallback por sub-lotes...`);
    }

    // Fallback en bloques paralelos de 10 para aislar correos inválidos sin ir 1x1 secuencial
    const CONCURRENCY = 10;
    for (let j = 0; j < lote.length; j += CONCURRENCY) {
      const subLote = lote.slice(j, j + CONCURRENCY);
      const resultados = await Promise.allSettled(
        subLote.map((item) => sendEmail(item))
      );
      resultados.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          enviados++;
          destinatarios.push(subLote[idx].to);
        } else {
          fallidos++;
        }
      });
    }
  }

  return { enviados, fallidos, destinatarios };
}

