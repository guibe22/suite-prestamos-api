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

/** Entitlement tal como lo devuelve la API REST de RevenueCat. */
export interface EntitlementSuscriptor {
  /** Clave del entitlement (ej. "pro"), que mapea a Plan.revenueCatEntitlementId. */
  id: string;
  /** ISO-8601, o null en una compra no-renovable de por vida. */
  expiresDate: string | null;
  productIdentifier: string | null;
}

export interface EstadoSuscriptorRevenueCat {
  /** Entitlements vigentes AHORA (ya filtrados por fecha de expiración). */
  activos: EntitlementSuscriptor[];
  /** Todos los conocidos, vigentes o no — para distinguir "expiró" de "nunca compró". */
  todos: EntitlementSuscriptor[];
}

const REVENUECAT_API_BASE = 'https://api.revenuecat.com/v1';
const REVENUECAT_TIMEOUT_MS = 10_000;

/** `true` si se puede consultar la API REST (hay clave secreta configurada). */
export function puedeConsultarRevenueCat(): boolean {
  return !!env.REVENUECAT_SECRET_API_KEY;
}

/**
 * Consulta el estado real del suscriptor en RevenueCat.
 *
 * Es la red de seguridad del webhook: si un evento se pierde (endpoint caído
 * más allá de la ventana de reintentos de RevenueCat, un despliegue en mal
 * momento), el usuario pagó y su suscripción nunca se activó. Preguntar
 * directamente devuelve la verdad sin depender de que el evento llegue.
 *
 * Usa la clave SECRETA (`sk_...`), distinta de la pública del SDK que se le
 * entrega al cliente en /suscripcion/config: esta nunca sale del servidor.
 *
 * Devuelve `null` si no hay clave configurada o el suscriptor no existe —
 * ambos casos significan "no sé", nunca "no tiene suscripción", para no
 * degradar a un usuario por un problema de configuración nuestro.
 */
export async function obtenerEstadoSuscriptor(
  appUserId: string
): Promise<EstadoSuscriptorRevenueCat | null> {
  if (!env.REVENUECAT_SECRET_API_KEY) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REVENUECAT_TIMEOUT_MS);
  try {
    const res = await fetch(`${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: {
        Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    // 404 = RevenueCat no conoce a este app_user_id (nunca abrió la app con el
    // SDK configurado). No es un error: simplemente no hay nada que reconciliar.
    if (res.status === 404) return { activos: [], todos: [] };
    if (!res.ok) {
      throw new Error(`RevenueCat respondió ${res.status} al consultar el suscriptor.`);
    }

    const json: any = await res.json();
    const entitlements = json?.subscriber?.entitlements ?? {};
    const ahora = Date.now();

    const todos: EntitlementSuscriptor[] = Object.entries(entitlements).map(
      ([id, valor]: [string, any]) => ({
        id,
        expiresDate: valor?.expires_date ?? null,
        productIdentifier: valor?.product_identifier ?? null,
      })
    );

    // `expires_date: null` en RevenueCat significa que no caduca (compra de por
    // vida), así que cuenta como activo.
    const activos = todos.filter(
      (e) => e.expiresDate === null || new Date(e.expiresDate).getTime() > ahora
    );

    return { activos, todos };
  } finally {
    clearTimeout(timeoutId);
  }
}
