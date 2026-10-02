import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  suscripcion: { findUnique: vi.fn(), update: vi.fn() },
  plan: { findFirst: vi.fn() },
};
vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../configuracion/configuracion.service.js', () => ({
  ConfiguracionService: class {},
}));

const obtenerEstadoSuscriptor = vi.fn();
const puedeConsultarRevenueCat = vi.fn(() => true);
vi.mock('../revenuecat.client.js', () => ({
  obtenerEstadoSuscriptor: (...a: unknown[]) => obtenerEstadoSuscriptor(...a),
  puedeConsultarRevenueCat: () => puedeConsultarRevenueCat(),
  verificarAutorizacionWebhook: vi.fn(),
}));

const { SuscripcionService } = await import('../suscripcion.service.js');

const PLAN_PRO = { id: 'plan-pro', codigo: 'PRO', nombre: 'Pro', revenueCatEntitlementId: 'pro' };

describe('SuscripcionService.reconciliarConRevenueCat', () => {
  const service = new SuscripcionService();

  beforeEach(() => {
    vi.clearAllMocks();
    puedeConsultarRevenueCat.mockReturnValue(true);
  });

  it('activa la suscripción cuando RevenueCat reporta un entitlement vigente', async () => {
    // Este es el caso que antes quedaba roto para siempre: el usuario pagó,
    // el webhook se perdió y nada volvía a mirar el estado real.
    mockPrisma.suscripcion.findUnique.mockResolvedValue({
      id: 's-1',
      planId: 'plan-free',
      estado: 'TRIAL',
      proveedor: 'REVENUE_CAT',
      periodoFinEn: null,
    });
    mockPrisma.plan.findFirst.mockResolvedValue(PLAN_PRO);
    obtenerEstadoSuscriptor.mockResolvedValue({
      activos: [{ id: 'pro', expiresDate: '2027-01-01T00:00:00Z', productIdentifier: 'pro_mensual' }],
      todos: [],
    });

    const r = await service.reconciliarConRevenueCat('org-1');

    expect(r.cambiado).toBe(true);
    expect(mockPrisma.suscripcion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's-1' },
        data: expect.objectContaining({ planId: 'plan-pro', estado: 'ACTIVA' }),
      })
    );
  });

  it('no escribe nada si el estado local ya coincide con la tienda', async () => {
    const fin = new Date('2027-01-01T00:00:00Z');
    mockPrisma.suscripcion.findUnique.mockResolvedValue({
      id: 's-1',
      planId: 'plan-pro',
      estado: 'ACTIVA',
      proveedor: 'REVENUE_CAT',
      periodoFinEn: fin,
    });
    mockPrisma.plan.findFirst.mockResolvedValue(PLAN_PRO);
    obtenerEstadoSuscriptor.mockResolvedValue({
      activos: [{ id: 'pro', expiresDate: fin.toISOString(), productIdentifier: 'pro_mensual' }],
      todos: [],
    });

    const r = await service.reconciliarConRevenueCat('org-1');

    expect(r.cambiado).toBe(false);
    expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
  });

  it('elige el plan de mayor orden si hay varios entitlements a la vez', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue({
      id: 's-1',
      planId: 'plan-basico',
      estado: 'ACTIVA',
      proveedor: 'REVENUE_CAT',
      periodoFinEn: null,
    });
    mockPrisma.plan.findFirst.mockResolvedValue(PLAN_PRO);
    obtenerEstadoSuscriptor.mockResolvedValue({
      activos: [
        { id: 'basico', expiresDate: '2027-01-01T00:00:00Z', productIdentifier: 'b' },
        { id: 'pro', expiresDate: '2027-01-01T00:00:00Z', productIdentifier: 'p' },
      ],
      todos: [],
    });

    await service.reconciliarConRevenueCat('org-1');

    expect(mockPrisma.plan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { orden: 'desc' } })
    );
  });

  describe('nunca degrada por un problema nuestro', () => {
    it('no toca nada si no hay clave secreta configurada', async () => {
      puedeConsultarRevenueCat.mockReturnValue(false);

      const r = await service.reconciliarConRevenueCat('org-1');

      expect(r.cambiado).toBe(false);
      expect(obtenerEstadoSuscriptor).not.toHaveBeenCalled();
      expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
    });

    it('no toca nada si la consulta a RevenueCat falla', async () => {
      mockPrisma.suscripcion.findUnique.mockResolvedValue({
        id: 's-1',
        planId: 'plan-pro',
        estado: 'ACTIVA',
        proveedor: 'REVENUE_CAT',
        periodoFinEn: null,
      });
      obtenerEstadoSuscriptor.mockRejectedValue(new Error('503 de RevenueCat'));

      const r = await service.reconciliarConRevenueCat('org-1');

      expect(r.cambiado).toBe(false);
      expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
    });

    it('no expira una suscripción pagada en EFECTIVO aunque RevenueCat no sepa de ella', async () => {
      // RevenueCat nunca va a reportar entitlements de un pago manual; tomar
      // ese silencio por "no tiene plan" le cortaría el acceso a un cliente
      // que pagó en efectivo.
      mockPrisma.suscripcion.findUnique.mockResolvedValue({
        id: 's-1',
        planId: 'plan-empresarial',
        estado: 'ACTIVA',
        proveedor: 'MANUAL',
        periodoFinEn: new Date('2027-01-01T00:00:00Z'),
      });
      obtenerEstadoSuscriptor.mockResolvedValue({ activos: [], todos: [] });

      const r = await service.reconciliarConRevenueCat('org-1');

      expect(r.cambiado).toBe(false);
      expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
    });

    it('no cambia el plan si la tienda reporta un entitlement que no reconocemos', async () => {
      mockPrisma.suscripcion.findUnique.mockResolvedValue({
        id: 's-1',
        planId: 'plan-pro',
        estado: 'ACTIVA',
        proveedor: 'REVENUE_CAT',
        periodoFinEn: null,
      });
      mockPrisma.plan.findFirst.mockResolvedValue(null);
      obtenerEstadoSuscriptor.mockResolvedValue({
        activos: [{ id: 'plan_que_no_existe', expiresDate: null, productIdentifier: 'x' }],
        todos: [],
      });

      const r = await service.reconciliarConRevenueCat('org-1');

      expect(r.cambiado).toBe(false);
      expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
    });
  });

  it('expira la suscripción de RevenueCat cuando la tienda ya no reporta nada activo', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue({
      id: 's-1',
      planId: 'plan-pro',
      estado: 'ACTIVA',
      proveedor: 'REVENUE_CAT',
      periodoFinEn: new Date('2026-01-01T00:00:00Z'),
    });
    obtenerEstadoSuscriptor.mockResolvedValue({ activos: [], todos: [] });

    const r = await service.reconciliarConRevenueCat('org-1');

    expect(r.cambiado).toBe(true);
    expect(mockPrisma.suscripcion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'EXPIRADA' }) })
    );
  });

  it('no reescribe una suscripción que ya estaba expirada', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue({
      id: 's-1',
      planId: 'plan-pro',
      estado: 'EXPIRADA',
      proveedor: 'REVENUE_CAT',
      periodoFinEn: new Date('2026-01-01T00:00:00Z'),
    });
    obtenerEstadoSuscriptor.mockResolvedValue({ activos: [], todos: [] });

    const r = await service.reconciliarConRevenueCat('org-1');

    expect(r.cambiado).toBe(false);
    expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
  });

  it('no hace nada si la organización no tiene suscripción', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue(null);

    const r = await service.reconciliarConRevenueCat('org-x');

    expect(r.cambiado).toBe(false);
    expect(obtenerEstadoSuscriptor).not.toHaveBeenCalled();
  });
});
