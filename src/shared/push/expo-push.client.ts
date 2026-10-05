import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Cliente del Expo Push Service.
 *
 * Se habla HTTP directo con Expo en vez de montar `firebase-admin` en el API:
 * evita meter el SDK de Firebase y su cuenta de servicio dentro del servidor, y
 * el manejo de tokens muertos llega gratis en la respuesta
 * (`DeviceNotRegistered`). Firebase sigue existiendo, pero solo como transporte
 * configurado en EAS — el backend no lo toca.
 */

const ENDPOINT_ENVIO = 'https://exp.host/--/api/v2/push/send';

/** Límite de la API de Expo: 100 mensajes por petición. */
const TAMANO_LOTE = 100;

const MAX_REINTENTOS = 3;
const ESPERA_BASE_MS = 500;

export interface MensajePush {
  /** ExponentPushToken[...] */
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Id del canal de Android; debe existir en la app. */
  channelId?: string;
  sound?: 'default' | null;
}

export type ResultadoEnvio =
  | { token: string; ok: true; ticketId?: string }
  | { token: string; ok: false; error: string; dispositivoNoRegistrado: boolean };

interface TicketExpo {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Un token tiene esta forma exacta. Validarlo antes de enviar evita gastar una
 * petición entera (y su reintento) en un lote que Expo va a rechazar completo.
 */
export function esTokenExpoValido(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

function trocear<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano));
  }
  return lotes;
}

async function enviarLote(lote: MensajePush[]): Promise<ResultadoEnvio[]> {
  const cabeceras: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
  };
  // Opcional: habilita el envío autenticado y las cuotas más altas de Expo.
  if (env.EXPO_ACCESS_TOKEN) {
    cabeceras.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  }

  let ultimoError = 'Error desconocido al contactar al servicio de push.';

  for (let intento = 0; intento < MAX_REINTENTOS; intento++) {
    try {
      const respuesta = await fetch(ENDPOINT_ENVIO, {
        method: 'POST',
        headers: cabeceras,
        body: JSON.stringify(lote),
      });

      // 429 (cuota) y 5xx son transitorios: reintentar con backoff. Un 4xx
      // distinto es culpa nuestra (payload mal formado) y reintentarlo solo
      // gasta cuota.
      if (respuesta.status === 429 || respuesta.status >= 500) {
        ultimoError = `El servicio de push respondió ${respuesta.status}.`;
        await esperar(ESPERA_BASE_MS * 2 ** intento);
        continue;
      }

      if (!respuesta.ok) {
        const texto = await respuesta.text().catch(() => '');
        ultimoError = `El servicio de push rechazó la petición (${respuesta.status}). ${texto}`.trim();
        break;
      }

      const json = (await respuesta.json()) as { data?: TicketExpo[] };
      const tickets = json.data ?? [];

      return lote.map((mensaje, i) => {
        const ticket = tickets[i];
        if (ticket?.status === 'ok') {
          return { token: mensaje.to, ok: true, ticketId: ticket.id };
        }
        const codigo = ticket?.details?.error;
        return {
          token: mensaje.to,
          ok: false,
          error: ticket?.message ?? 'El servicio de push no devolvió un ticket para este mensaje.',
          dispositivoNoRegistrado: codigo === 'DeviceNotRegistered',
        };
      });
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
      await esperar(ESPERA_BASE_MS * 2 ** intento);
    }
  }

  // Agotados los reintentos: todo el lote se marca como fallido, pero NO como
  // dispositivo no registrado — el token puede seguir siendo válido y no hay
  // que desactivarlo por un problema de red nuestro.
  return lote.map((mensaje) => ({
    token: mensaje.to,
    ok: false,
    error: ultimoError,
    dispositivoNoRegistrado: false,
  }));
}

/**
 * Envía los mensajes en lotes de 100 y devuelve un resultado por token, en el
 * mismo orden en que se recibieron. Nunca lanza: un fallo de envío es un dato
 * del resultado, no una excepción — el llamador tiene que poder registrar el
 * error en la notificación y seguir.
 */
export async function enviarPush(mensajes: MensajePush[]): Promise<ResultadoEnvio[]> {
  if (mensajes.length === 0) return [];

  const validos: MensajePush[] = [];
  const resultados = new Map<number, ResultadoEnvio>();

  mensajes.forEach((mensaje, i) => {
    if (esTokenExpoValido(mensaje.to)) {
      validos.push(mensaje);
    } else {
      // Un token con formato inválido no se va a arreglar solo: se trata como
      // dispositivo no registrado para que el llamador lo desactive.
      resultados.set(i, {
        token: mensaje.to,
        ok: false,
        error: 'El token no tiene el formato de un token de Expo.',
        dispositivoNoRegistrado: true,
      });
    }
  });

  const porToken = new Map<string, ResultadoEnvio>();
  for (const lote of trocear(validos, TAMANO_LOTE)) {
    const resultadosLote = await enviarLote(lote);
    for (const resultado of resultadosLote) {
      porToken.set(resultado.token, resultado);
    }
  }

  return mensajes.map((mensaje, i) => {
    const previo = resultados.get(i);
    if (previo) return previo;
    return (
      porToken.get(mensaje.to) ?? {
        token: mensaje.to,
        ok: false,
        error: 'El servicio de push no devolvió resultado para este token.',
        dispositivoNoRegistrado: false,
      }
    );
  });
}

/**
 * Consulta los acuses de recibo de los tickets. El ticket inicial solo dice
 * que Expo aceptó el mensaje; el acuse dice si FCM/APNs lo entregó de verdad,
 * y es donde aparecen los `DeviceNotRegistered` tardíos.
 *
 * Expo pide esperar ~15 minutos antes de consultarlos.
 */
export async function consultarAcuses(
  ticketIds: string[]
): Promise<Map<string, { ok: boolean; error?: string; dispositivoNoRegistrado: boolean }>> {
  const salida = new Map<string, { ok: boolean; error?: string; dispositivoNoRegistrado: boolean }>();
  if (ticketIds.length === 0) return salida;

  const cabeceras: Record<string, string> = { 'content-type': 'application/json' };
  if (env.EXPO_ACCESS_TOKEN) {
    cabeceras.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  }

  for (const lote of trocear(ticketIds, TAMANO_LOTE * 10)) {
    try {
      const respuesta = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers: cabeceras,
        body: JSON.stringify({ ids: lote }),
      });
      if (!respuesta.ok) continue;

      const json = (await respuesta.json()) as {
        data?: Record<string, { status: string; message?: string; details?: { error?: string } }>;
      };

      for (const [id, acuse] of Object.entries(json.data ?? {})) {
        salida.set(id, {
          ok: acuse.status === 'ok',
          error: acuse.message,
          dispositivoNoRegistrado: acuse.details?.error === 'DeviceNotRegistered',
        });
      }
    } catch (e) {
      logger.warn(e, 'No se pudieron consultar los acuses de push.');
    }
  }

  return salida;
}
