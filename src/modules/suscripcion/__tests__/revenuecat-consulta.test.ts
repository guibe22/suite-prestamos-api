import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockEnv: Record<string, string | undefined> = {};
vi.mock('../../../config/env.js', () => ({ env: mockEnv }));

const { obtenerEstadoSuscriptor, puedeConsultarRevenueCat } = await import('../revenuecat.client.js');

function responderCon(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as any);
}

describe('obtenerEstadoSuscriptor (consulta a RevenueCat)', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    mockEnv.REVENUECAT_SECRET_API_KEY = 'sk_de_prueba';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no consulta nada si no hay clave secreta configurada', async () => {
    delete mockEnv.REVENUECAT_SECRET_API_KEY;
    const fetchMock = responderCon(200);
    vi.stubGlobal('fetch', fetchMock);

    expect(puedeConsultarRevenueCat()).toBe(false);
    expect(await obtenerEstadoSuscriptor('org-1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('con REVENUECAT_PROJECT_ID (API v2, las claves que se emiten hoy)', () => {
    beforeEach(() => {
      mockEnv.REVENUECAT_PROJECT_ID = 'proj_123';
    });

    it('llama al endpoint v2 de entitlements activos', async () => {
      const fetchMock = responderCon(200, { items: [] });
      vi.stubGlobal('fetch', fetchMock);

      await obtenerEstadoSuscriptor('org-1');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.revenuecat.com/v2/projects/proj_123/customers/org-1/active_entitlements'
      );
    });

    it('convierte expires_at en ms a ISO y marca el entitlement como vigente', async () => {
      const futuro = Date.now() + 86_400_000;
      vi.stubGlobal(
        'fetch',
        responderCon(200, {
          items: [{ entitlement_id: 'pro', expires_at: futuro, product_id: 'pro_mensual' }],
        })
      );

      const estado = await obtenerEstadoSuscriptor('org-1');

      expect(estado?.activos).toHaveLength(1);
      expect(estado?.activos[0].id).toBe('pro');
      expect(estado?.activos[0].expiresDate).toBe(new Date(futuro).toISOString());
    });

    it('descarta un entitlement ya vencido', async () => {
      vi.stubGlobal(
        'fetch',
        responderCon(200, {
          items: [{ entitlement_id: 'pro', expires_at: Date.now() - 1000 }],
        })
      );

      const estado = await obtenerEstadoSuscriptor('org-1');

      expect(estado?.activos).toHaveLength(0);
      expect(estado?.todos).toHaveLength(1);
    });

    it('trata expires_at null como "no caduca"', async () => {
      vi.stubGlobal(
        'fetch',
        responderCon(200, { items: [{ entitlement_id: 'pro', expires_at: null }] })
      );

      const estado = await obtenerEstadoSuscriptor('org-1');

      expect(estado?.activos).toHaveLength(1);
    });
  });

  describe('sin REVENUECAT_PROJECT_ID (API v1, claves heredadas)', () => {
    it('llama al endpoint v1 de subscribers', async () => {
      const fetchMock = responderCon(200, { subscriber: { entitlements: {} } });
      vi.stubGlobal('fetch', fetchMock);

      await obtenerEstadoSuscriptor('org-1');

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.revenuecat.com/v1/subscribers/org-1');
    });

    it('lee los entitlements del formato v1', async () => {
      const futuro = new Date(Date.now() + 86_400_000).toISOString();
      vi.stubGlobal(
        'fetch',
        responderCon(200, {
          subscriber: {
            entitlements: { pro: { expires_date: futuro, product_identifier: 'pro_mensual' } },
          },
        })
      );

      const estado = await obtenerEstadoSuscriptor('org-1');

      expect(estado?.activos[0]).toEqual({
        id: 'pro',
        expiresDate: futuro,
        productIdentifier: 'pro_mensual',
      });
    });

    it('ante un 403 explica que hay que pasar a la v2, no que la clave esté mal', async () => {
      // Es el fallo esperable hoy: RevenueCat ya solo emite claves de
      // generación v2, y contra un endpoint v1 responden 403. Cambiar de
      // clave no lo arregla; hay que configurar el project id.
      vi.stubGlobal('fetch', responderCon(403));

      await expect(obtenerEstadoSuscriptor('org-1')).rejects.toThrow(/REVENUECAT_PROJECT_ID/);
    });
  });

  it('un cliente desconocido (404) no es un error: no hay nada que reconciliar', async () => {
    vi.stubGlobal('fetch', responderCon(404));

    const estado = await obtenerEstadoSuscriptor('org-nueva');

    expect(estado).toEqual({ activos: [], todos: [] });
  });

  it('propaga un fallo del servidor de RevenueCat', async () => {
    vi.stubGlobal('fetch', responderCon(503));

    await expect(obtenerEstadoSuscriptor('org-1')).rejects.toThrow(/503/);
  });
});
