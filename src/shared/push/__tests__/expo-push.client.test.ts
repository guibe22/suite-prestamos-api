import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/env.js', () => ({ env: { EXPO_ACCESS_TOKEN: undefined } }));
vi.mock('../../../config/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { enviarPush, esTokenExpoValido } = await import('../expo-push.client.js');

const TOKEN = (n: number) => `ExponentPushToken[token-${n}]`;

const mensaje = (n: number) => ({ to: TOKEN(n), title: 'Hola', body: 'Cuerpo' });

/** Respuesta con forma de la API de Expo. */
function respuestaExpo(tickets: unknown[], status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data: tickets }),
    text: async () => JSON.stringify({ data: tickets }),
  };
}

describe('esTokenExpoValido', () => {
  it('acepta las dos formas que emite Expo', () => {
    expect(esTokenExpoValido('ExponentPushToken[xxx]')).toBe(true);
    expect(esTokenExpoValido('ExpoPushToken[xxx]')).toBe(true);
  });

  it('rechaza basura', () => {
    expect(esTokenExpoValido('')).toBe(false);
    expect(esTokenExpoValido('fcm-token-crudo')).toBe(false);
    expect(esTokenExpoValido('ExponentPushToken[]')).toBe(false);
  });
});

describe('enviarPush', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sin mensajes no llama a la red', async () => {
    const resultado = await enviarPush([]);
    expect(resultado).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mapea cada ticket a su token en el mismo orden', async () => {
    fetchMock.mockResolvedValue(respuestaExpo([{ status: 'ok', id: 't1' }, { status: 'ok', id: 't2' }]));

    const resultado = await enviarPush([mensaje(1), mensaje(2)]);

    expect(resultado).toEqual([
      { token: TOKEN(1), ok: true, ticketId: 't1' },
      { token: TOKEN(2), ok: true, ticketId: 't2' },
    ]);
  });

  it('marca DeviceNotRegistered para que el llamador desactive el token', async () => {
    fetchMock.mockResolvedValue(
      respuestaExpo([
        { status: 'error', message: 'no existe', details: { error: 'DeviceNotRegistered' } },
      ])
    );

    const [resultado] = await enviarPush([mensaje(1)]);

    expect(resultado.ok).toBe(false);
    expect(resultado).toMatchObject({ dispositivoNoRegistrado: true });
  });

  it('un error de Expo que NO es DeviceNotRegistered no desactiva el token', async () => {
    fetchMock.mockResolvedValue(
      respuestaExpo([{ status: 'error', message: 'MessageTooBig', details: { error: 'MessageTooBig' } }])
    );

    const [resultado] = await enviarPush([mensaje(1)]);

    expect(resultado).toMatchObject({ ok: false, dispositivoNoRegistrado: false });
  });

  it('un token con formato inválido se descarta sin gastar una petición', async () => {
    const resultado = await enviarPush([{ to: 'basura', title: 'a', body: 'b' }]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(resultado[0]).toMatchObject({ ok: false, dispositivoNoRegistrado: true });
  });

  it('trocea en lotes de 100', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const lote = JSON.parse(init.body) as unknown[];
      return respuestaExpo(lote.map(() => ({ status: 'ok', id: 'x' })));
    });

    const mensajes = Array.from({ length: 250 }, (_, i) => mensaje(i));
    const resultado = await enviarPush(mensajes);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    expect(resultado).toHaveLength(250);
    expect(resultado.every((r) => r.ok)).toBe(true);
  });

  it('reintenta ante un 429 y termina entregando', async () => {
    fetchMock
      .mockResolvedValueOnce(respuestaExpo([], 429))
      .mockResolvedValueOnce(respuestaExpo([{ status: 'ok', id: 't1' }]));

    const promesa = enviarPush([mensaje(1)]);
    await vi.runAllTimersAsync();
    const [resultado] = await promesa;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resultado.ok).toBe(true);
  });

  it('agotados los reintentos falla sin desactivar el token: la culpa es de la red, no del dispositivo', async () => {
    fetchMock.mockResolvedValue(respuestaExpo([], 503));

    const promesa = enviarPush([mensaje(1)]);
    await vi.runAllTimersAsync();
    const [resultado] = await promesa;

    expect(resultado).toMatchObject({ ok: false, dispositivoNoRegistrado: false });
  });

  it('un 400 no se reintenta: el payload está mal y reintentarlo solo gasta cuota', async () => {
    fetchMock.mockResolvedValue(respuestaExpo([], 400));

    const promesa = enviarPush([mensaje(1)]);
    await vi.runAllTimersAsync();
    const [resultado] = await promesa;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultado.ok).toBe(false);
  });

  it('nunca lanza: un fallo de red es un dato del resultado', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const promesa = enviarPush([mensaje(1)]);
    await vi.runAllTimersAsync();

    await expect(promesa).resolves.toMatchObject([{ ok: false }]);
  });

  it('si Expo devuelve menos tickets que mensajes, los faltantes quedan como fallidos', async () => {
    fetchMock.mockResolvedValue(respuestaExpo([{ status: 'ok', id: 't1' }]));

    const resultado = await enviarPush([mensaje(1), mensaje(2)]);

    expect(resultado[0].ok).toBe(true);
    expect(resultado[1].ok).toBe(false);
  });
});
