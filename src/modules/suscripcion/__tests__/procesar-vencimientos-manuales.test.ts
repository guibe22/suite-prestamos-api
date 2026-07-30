import { describe, it, expect, vi, beforeEach } from 'vitest';

const DIA_MS = 24 * 60 * 60 * 1000;

const mockPrisma = {
  suscripcion: { findMany: vi.fn(), update: vi.fn() },
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));

const { SuscripcionService } = await import('../suscripcion.service.js');

function suscripcionManual(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    organizacionId: 'org-1',
    proveedor: 'MANUAL',
    estado: 'ACTIVA',
    diasGraciaSuspension: null,
    periodoFinEn: new Date(Date.now() + 10 * DIA_MS),
    ...overrides,
  };
}

describe('SuscripcionService.procesarVencimientosManuales', () => {
  const service = new SuscripcionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.suscripcion.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data })
    );
  });

  it('no hace nada si no hay suscripciones MANUAL activas con periodoFinEn', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([]);

    const resultado = await service.procesarVencimientosManuales();

    expect(resultado).toEqual({ suspendidos: 0 });
    expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
  });

  it('suspende la suscripción cuando ya pasaron los días de gracia tras el vencimiento', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([
      suscripcionManual({
        diasGraciaSuspension: 3,
        periodoFinEn: new Date(Date.now() - 4 * DIA_MS),
      }),
    ]);

    const resultado = await service.procesarVencimientosManuales();

    expect(resultado.suspendidos).toBe(1);
    expect(mockPrisma.suscripcion.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { estado: 'SUSPENDIDA' },
    });
  });

  it('no suspende todavía mientras esté dentro de los días de gracia configurados', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([
      suscripcionManual({
        diasGraciaSuspension: 5,
        periodoFinEn: new Date(Date.now() - 2 * DIA_MS),
      }),
    ]);

    const resultado = await service.procesarVencimientosManuales();

    expect(resultado.suspendidos).toBe(0);
    expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
  });

  it('sin diasGraciaSuspension configurado, suspende apenas se cumple periodoFinEn', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([
      suscripcionManual({
        diasGraciaSuspension: null,
        periodoFinEn: new Date(Date.now() - 1000),
      }),
    ]);

    const resultado = await service.procesarVencimientosManuales();

    expect(resultado.suspendidos).toBe(1);
  });
});
