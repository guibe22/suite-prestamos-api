import { GoogleAuth } from 'google-auth-library';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

let cachedAuth: GoogleAuth | null = null;

function obtenerAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;

  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new BadRequestError('Google Play Billing no está configurado en este entorno.');
  }

  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  cachedAuth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  return cachedAuth;
}

/** Subconjunto de EstadoSuscripcion que puede derivarse de una compra de Google. */
type EstadoDesdeGoogle = 'TRIAL' | 'ACTIVA' | 'PENDIENTE_PAGO' | 'SUSPENDIDA' | 'CANCELADA' | 'EXPIRADA';

const ESTADOS_GOOGLE: Record<string, EstadoDesdeGoogle> = {
  SUBSCRIPTION_STATE_PENDING: 'PENDIENTE_PAGO',
  SUBSCRIPTION_STATE_ACTIVE: 'ACTIVA',
  // En gracia todavía tiene acceso mientras Google reintenta el cobro.
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'ACTIVA',
  SUBSCRIPTION_STATE_ON_HOLD: 'SUSPENDIDA',
  SUBSCRIPTION_STATE_PAUSED: 'SUSPENDIDA',
  SUBSCRIPTION_STATE_CANCELED: 'CANCELADA',
  SUBSCRIPTION_STATE_EXPIRED: 'EXPIRADA',
};

export interface EstadoCompraGoogle {
  estado: EstadoDesdeGoogle;
  productId: string | null;
  expiryTime: Date | null;
  latestOrderId: string | null;
}

/**
 * Verdad de una compra de Google Play, consultada directamente a la Play
 * Developer API (purchases.subscriptionsv2.get). El payload de un push RTDN
 * NUNCA se usa como fuente de verdad, solo como disparador para llamar aquí.
 */
export async function verificarCompraGoogle(purchaseToken: string): Promise<EstadoCompraGoogle> {
  if (!env.GOOGLE_PLAY_PACKAGE_NAME) {
    throw new BadRequestError('GOOGLE_PLAY_PACKAGE_NAME no está configurado en este entorno.');
  }

  const auth = obtenerAuth();
  const client = await auth.getClient();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/` +
    `${encodeURIComponent(purchaseToken)}`;

  const response = await client.request<{
    subscriptionState?: string;
    latestOrderId?: string;
    lineItems?: Array<{ productId?: string; expiryTime?: string }>;
  }>({ url });

  const data = response.data;
  const estado = (data.subscriptionState && ESTADOS_GOOGLE[data.subscriptionState]) || 'EXPIRADA';
  const lineItem = data.lineItems?.[0];

  return {
    estado,
    productId: lineItem?.productId ?? null,
    expiryTime: lineItem?.expiryTime ? new Date(lineItem.expiryTime) : null,
    latestOrderId: data.latestOrderId ?? null,
  };
}

export interface NotificacionRtdn {
  purchaseToken: string;
  subscriptionId: string; // productId de Play Console
  notificationType: number;
}

/**
 * Decodifica el envelope de Pub/Sub de un Real-Time Developer Notification.
 * Solo se usa para saber "qué token revisar" — el contenido de
 * `subscriptionNotification` no se persiste directamente, se vuelve a
 * verificar contra la API (ver `verificarCompraGoogle`).
 */
export function decodificarNotificacionRtdn(body: any): NotificacionRtdn | null {
  const dataB64 = body?.message?.data;
  if (!dataB64) return null;

  let json: any;
  try {
    json = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf-8'));
  } catch {
    return null;
  }

  const sub = json?.subscriptionNotification;
  if (!sub?.purchaseToken) return null;

  return {
    purchaseToken: sub.purchaseToken,
    subscriptionId: sub.subscriptionId,
    notificationType: sub.notificationType,
  };
}
