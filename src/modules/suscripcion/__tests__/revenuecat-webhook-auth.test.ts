import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/env.js', () => ({ env: { REVENUECAT_WEBHOOK_SECRET: 'el-secreto-correcto' } }));

const { verificarAutorizacionWebhook } = await import('../revenuecat.client.js');

describe('verificarAutorizacionWebhook', () => {
  it('acepta cuando el header coincide exactamente con el secreto configurado', () => {
    expect(verificarAutorizacionWebhook('el-secreto-correcto')).toBe(true);
  });

  it('rechaza un secreto incorrecto de la misma longitud', () => {
    expect(verificarAutorizacionWebhook('el-secreto-incorrectx')).toBe(false);
  });

  it('rechaza un secreto de longitud distinta sin lanzar (antes de la corrección, timingSafeEqual habría explotado con largos distintos)', () => {
    expect(verificarAutorizacionWebhook('corto')).toBe(false);
    expect(verificarAutorizacionWebhook('un-header-mucho-mas-largo-que-el-secreto-real')).toBe(false);
  });

  it('rechaza si no hay header', () => {
    expect(verificarAutorizacionWebhook(undefined)).toBe(false);
  });
});

describe('verificarAutorizacionWebhook — sin REVENUECAT_WEBHOOK_SECRET configurado', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('lanza BadRequestError en vez de dejar pasar por defecto', async () => {
    vi.doMock('../../../config/env.js', () => ({ env: { REVENUECAT_WEBHOOK_SECRET: undefined } }));
    const { verificarAutorizacionWebhook: verificarSinSecreto } = await import('../revenuecat.client.js');
    expect(() => verificarSinSecreto('cualquier-cosa')).toThrow(/REVENUECAT_WEBHOOK_SECRET/);
  });
});
