import { env } from '../../config/env.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

const BASE_URL =
  env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function requireCredenciales(): { clientId: string; clientSecret: string } {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new BadRequestError('PayPal no está configurado en este entorno.');
  }
  return { clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET };
}

async function obtenerAccessToken(): Promise<string> {
  // Margen de 30s para no usar un token a punto de expirar en la siguiente
  // llamada a la API de PayPal.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const { clientId, clientSecret } = requireCredenciales();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`No se pudo obtener el token de PayPal (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

export interface PaypalSuscripcionCreada {
  id: string;
  approveUrl: string;
}

/**
 * Crea la suscripción en PayPal y devuelve el link hospedado (`rel=approve`)
 * al que el cliente redirige al usuario — no hace falta embeber el JS SDK de
 * PayPal en la app/web.
 */
export async function crearSuscripcion(params: {
  paypalPlanId: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<PaypalSuscripcionCreada> {
  const accessToken = await obtenerAccessToken();

  const response = await fetch(`${BASE_URL}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan_id: params.paypalPlanId,
      application_context: {
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        user_action: 'SUBSCRIBE_NOW',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo crear la suscripción en PayPal (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as { id: string; links: Array<{ rel: string; href: string }> };
  const approveLink = data.links.find((link) => link.rel === 'approve');
  if (!approveLink) {
    throw new Error('PayPal no devolvió un link de aprobación para la suscripción.');
  }

  return { id: data.id, approveUrl: approveLink.href };
}

export interface PaypalProductoCreado {
  id: string;
}

/**
 * Crea el "producto" en el catálogo de PayPal (POST /v1/catalogs/products) —
 * paso previo obligatorio antes de poder crear un billing plan sobre él.
 * Automatiza lo que antes se hacía a mano por PowerShell.
 */
export async function crearProductoPaypal(params: {
  nombre: string;
  descripcion?: string;
}): Promise<PaypalProductoCreado> {
  const accessToken = await obtenerAccessToken();

  const response = await fetch(`${BASE_URL}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: params.nombre,
      description: params.descripcion,
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo crear el producto en PayPal (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

export interface PaypalPlanBillingCreado {
  id: string;
}

/**
 * Crea el billing plan mensual de precio fijo sobre un producto ya existente
 * (POST /v1/billing/plans) — mismo body que usábamos manualmente por
 * PowerShell (ciclo mensual, precio fijo, auto-cobro con reintentos).
 */
export async function crearPlanBillingPaypal(params: {
  productId: string;
  nombre: string;
  precioMensual: number;
  moneda: string;
}): Promise<PaypalPlanBillingCreado> {
  const accessToken = await obtenerAccessToken();

  const response = await fetch(`${BASE_URL}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      product_id: params.productId,
      name: params.nombre,
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: params.precioMensual.toFixed(2), currency_code: params.moneda },
          },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo crear el plan en PayPal (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

export interface EncabezadosWebhookPaypal {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

/**
 * Verifica la firma de un webhook de PayPal contra su API oficial
 * (POST /v1/notifications/verify-webhook-signature, acepta el body ya
 * parseado como JSON — no requiere el cuerpo crudo de la petición).
 */
export async function verificarFirmaWebhook(
  headers: EncabezadosWebhookPaypal,
  body: unknown,
): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) {
    throw new BadRequestError('PAYPAL_WEBHOOK_ID no está configurado en este entorno.');
  }

  const accessToken = await obtenerAccessToken();

  const response = await fetch(`${BASE_URL}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transmission_id: headers.transmissionId,
      transmission_time: headers.transmissionTime,
      cert_url: headers.certUrl,
      auth_algo: headers.authAlgo,
      transmission_sig: headers.transmissionSig,
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: body,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `No se pudo verificar la firma del webhook de PayPal (${response.status}): ${await response.text()}`
    );
  }

  const data = (await response.json()) as { verification_status: string };
  return data.verification_status === 'SUCCESS';
}
