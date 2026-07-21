import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

/**
 * RevenueCat no firma el body como PayPal: autentica el webhook comparando el
 * header Authorization contra el secreto configurado al crear el webhook en
 * su dashboard (Project settings > Integrations > Webhooks). Comparación en
 * tiempo constante para no filtrar el secreto por timing.
 */
export function verificarAutorizacionWebhook(authHeader: string | undefined): boolean {
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    throw new BadRequestError('REVENUECAT_WEBHOOK_SECRET no está configurado en este entorno.');
  }
  if (!authHeader) return false;

  // Se compara el hash de cada valor (siempre 32 bytes), no el valor crudo —
  // así ninguna rama depende de la longitud de `authHeader`, y timingSafeEqual
  // nunca puede recibir buffers de tamaños distintos.
  const hash = (valor: string) => crypto.createHash('sha256').update(valor, 'utf8').digest();
  return crypto.timingSafeEqual(hash(env.REVENUECAT_WEBHOOK_SECRET), hash(authHeader));
}

/**
 * Tipos de evento documentados por RevenueCat. Se tipa como string además de
 * los literales conocidos porque RevenueCat sigue agregando tipos nuevos con
 * el tiempo; los desconocidos simplemente no cambian el estado de la
 * suscripción (ver `procesarEventoRevenueCat`).
 */
export type TipoEventoRevenueCat =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'NON_RENEWING_PURCHASE'
  | 'SUBSCRIPTION_PAUSED'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE'
  | 'TRANSFER'
  | 'TEST'
  | (string & {});

export interface EventoRevenueCat {
  id: string;
  type: TipoEventoRevenueCat;
  /** Configurado desde el SDK como `Purchases.configure({ appUserID })` — es el organizacionId. */
  app_user_id: string;
  entitlement_ids?: string[] | null;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
}

/** Payload completo que RevenueCat envía al webhook: `{ api_version, event }`. */
export interface WebhookRevenueCat {
  api_version: string;
  event: EventoRevenueCat;
}
