import { describe, it, expect, vi } from 'vitest';

const obtenerPublica = vi.fn(async () => ({ minVersionApp: '2.1.0' }));
vi.mock('../../modules/configuracion/configuracion.service.js', () => ({
  ConfiguracionService: class {
    obtenerPublica = obtenerPublica;
  },
}));
vi.mock('../../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { requireMinAppVersion } = await import('../version.middleware.js');

async function correr(headers: Record<string, string>) {
  const next = vi.fn();
  await requireMinAppVersion()({ headers } as never, {} as never, next);
  return next.mock.calls[0]?.[0];
}

describe('versión mínima en el push', () => {
  it('rechaza una app sin versión cuando hay mínima configurada', async () => {
    expect(await correr({})).toBeInstanceOf(Error);
  });

  it('rechaza una app desactualizada y deja pasar una al día', async () => {
    expect(await correr({ 'x-app-version': '2.0.9' })).toBeInstanceOf(Error);
    expect(await correr({ 'x-app-version': '2.1.0' })).toBeUndefined();
  });

  it('deja pasar al panel web, que no tiene versión de app', async () => {
    expect(await correr({ 'x-cliente': 'panel-web' })).toBeUndefined();
  });
});
