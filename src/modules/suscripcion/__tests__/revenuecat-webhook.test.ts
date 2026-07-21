import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTx = {
  suscripcionEvento: { create: vi.fn() },
  suscripcion: { update: vi.fn() },
  plan: { findFirst: vi.fn() },
};

const mockPrisma = {
  suscripcion: { findUnique: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<void>) => cb(mockTx)),
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));

const { SuscripcionService } = await import('../suscripcion.service.js');

function eventoBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-1',
    type: 'INITIAL_PURCHASE',
    app_user_id: 'org-1',
    entitlement_ids: ['basico'],
    purchased_at_ms: Date.now(),
    expiration_at_ms: Date.now() + 1000,
    ...overrides,
  } as any;
}

describe('SuscripcionService.procesarEventoRevenueCat', () => {
  const service = new SuscripcionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<void>) => cb(mockTx));
  });

  it('registra el evento y aplica el cambio de estado dentro de LA MISMA transacción', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue({ id: 'sub-1' });
    mockTx.suscripcionEvento.create.mockResolvedValue({});
    mockTx.plan.findFirst.mockResolvedValue({ id: 'plan-basico' });
    mockTx.suscripcion.update.mockResolvedValue({});

    await service.procesarEventoRevenueCat(eventoBase());

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.suscripcionEvento.create).toHaveBeenCalledTimes(1);
    expect(mockTx.suscripcion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ estado: 'ACTIVA', planId: 'plan-basico' }),
      })
    );
  });

  it('reintento del webhook (P2002 = evento ya procesado) no vuelve a aplicar el cambio', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue({ id: 'sub-1' });
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    mockTx.suscripcionEvento.create.mockRejectedValue(p2002);

    await service.procesarEventoRevenueCat(eventoBase());

    expect(mockTx.suscripcion.update).not.toHaveBeenCalled();
  });

  it(
    'si aplicar el cambio falla, el error se propaga en vez de tragarse — así la transacción ' +
      'revierte TAMBIÉN el registro del evento, y el próximo reintento del webhook lo vuelve a intentar',
    async () => {
      mockPrisma.suscripcion.findUnique.mockResolvedValue({ id: 'sub-1' });
      mockTx.suscripcionEvento.create.mockResolvedValue({});
      mockTx.plan.findFirst.mockResolvedValue(null);
      mockTx.suscripcion.update.mockRejectedValue(new Error('DB caída a mitad de camino'));

      await expect(service.procesarEventoRevenueCat(eventoBase())).rejects.toThrow('DB caída a mitad de camino');

      // Una sola llamada a $transaction para las dos operaciones: si la de
      // adentro falla, Prisma revierte el create del evento también.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    }
  );

  it('organización desconocida: se registra el evento para auditoría, pero no actualiza nada', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue(null);
    mockTx.suscripcionEvento.create.mockResolvedValue({});

    await service.procesarEventoRevenueCat(eventoBase({ app_user_id: 'org-inexistente' }));

    expect(mockTx.suscripcionEvento.create).toHaveBeenCalledTimes(1);
    expect(mockTx.suscripcion.update).not.toHaveBeenCalled();
  });
});
