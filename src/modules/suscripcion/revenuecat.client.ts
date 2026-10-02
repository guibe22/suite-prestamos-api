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

const REVENUECAT_API_BASE = 'https://api.revenuecat.com';
const REVENUECAT_TIMEOUT_MS = 10_000;

/** `true` si se puede consultar la API REST (hay clave secreta configurada). */
export function puedeConsultarRevenueCat(): boolean {
  return !!env.REVENUECAT_SECRET_API_KEY;
}

async function pedirARevenueCat(path: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REVENUECAT_TIMEOUT_MS);
  try {
    return await fetch(`${REVENUECAT_API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Normaliza a ISO-8601, o null si el entitlement no caduca. */
function aIso(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return new Date(valor).toISOString();
  return valor;
}

function soloVigentes(todos: EntitlementSuscriptor[]): EntitlementSuscriptor[] {
  const ahora = Date.now();
  // `expiresDate: null` significa que no caduca (compra de por vida).
  return todos.filter((e) => e.expiresDate === null || new Date(e.expiresDate).getTime() > ahora);
}

/**
 * API v2: `/v2/projects/{projectId}/customers/{customerId}/active_entitlements`.
 * Es la que corresponde a las claves secretas que RevenueCat emite hoy.
 */
async function consultarV2(appUserId: string): Promise<EstadoSuscriptorRevenueCat | null> {
  const res = await pedirARevenueCat(
    `/v2/projects/${encodeURIComponent(env.REVENUECAT_PROJECT_ID!)}` +
      `/customers/${encodeURIComponent(appUserId)}/active_entitlements`
  );

  // El cliente no existe todavía en RevenueCat: no hay nada que reconciliar.
  if (res.status === 404) return { activos: [], todos: [] };
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'RevenueCat rechazó la clave secreta en la API v2. Revisa REVENUECAT_SECRET_API_KEY y REVENUECAT_PROJECT_ID.'
    );
  }
  if (!res.ok) {
    throw new Error(`RevenueCat (v2) respondió ${res.status} al consultar el cliente.`);
  }

  const json: any = await res.json();
  // Este endpoint ya devuelve solo los activos; se vuelve a filtrar por fecha
  // por si acaso, y se reusa `todos` para no inventar una forma distinta.
  const todos: EntitlementSuscriptor[] = (json?.items ?? []).map((item: any) => ({
    id: item?.entitlement_id,
    expiresDate: aIso(item?.expires_at),
    productIdentifier: item?.product_id ?? null,
  }));

  return { activos: soloVigentes(todos), todos };
}

/** API v1: `/v1/subscribers/{appUserId}`. Solo funciona con claves v1 (heredadas). */
async function consultarV1(appUserId: string): Promise<EstadoSuscriptorRevenueCat | null> {
  const res = await pedirARevenueCat(`/v1/subscribers/${encodeURIComponent(appUserId)}`);

  if (res.status === 404) return { activos: [], todos: [] };
  if (res.status === 401 || res.status === 403) {
    // El caso más probable: una clave secreta moderna (v2) contra un endpoint
    // v1. No se puede arreglar cambiando de clave — hay que pasar a la v2.
    throw new Error(
      'RevenueCat rechazó la clave secreta en la API v1. Si la clave es nueva (generación v2), ' +
        'configura REVENUECAT_PROJECT_ID para que la reconciliación use la API v2.'
    );
  }
  if (!res.ok) {
    throw new Error(`RevenueCat (v1) respondió ${res.status} al consultar el suscriptor.`);
  }

  const json: any = await res.json();
  const entitlements = json?.subscriber?.entitlements ?? {};

  const todos: EntitlementSuscriptor[] = Object.entries(entitlements).map(
    ([id, valor]: [string, any]) => ({
      id,
      expiresDate: aIso(valor?.expires_date),
      productIdentifier: valor?.product_identifier ?? null,
    })
  );

  return { activos: soloVigentes(todos), todos };
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

  // Las claves secretas de RevenueCat son de dos generaciones y NO son
  // intercambiables entre versiones de la API. Hoy solo se emiten claves v2,
  // así que la v2 es el camino normal; la v1 queda para cuentas con una clave
  // heredada. `REVENUECAT_PROJECT_ID` es lo que decide cuál usar, porque la
  // v2 lo necesita en la ruta y la v1 no.
  return env.REVENUECAT_PROJECT_ID ? consultarV2(appUserId) : consultarV1(appUserId);
}
