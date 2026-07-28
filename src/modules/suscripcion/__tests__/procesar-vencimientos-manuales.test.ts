import { describe, it, expect, vi, beforeEach } from 'vitest';

const DIA_MS = 24 * 60 * 60 * 1000;

const mockPrisma = {
  suscripcion: { findMany: vi.fn(), update: vi.fn() },
  usuario: { findMany: vi.fn() },
};

const mockSendEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../shared/email/email.service.js', () => ({ sendEmail: mockSendEmail }));

const { SuscripcionService } = await import('../suscripcion.service.js');

function suscripcionManual(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    organizacionId: 'org-1',
    proveedor: 'MANUAL',
    estado: 'ACTIVA',
    avisoDias: null,
    avisoEnviadoEn: null,
    diasGraciaSuspension: null,
    periodoFinEn: new Date(Date.now() + 10 * DIA_MS),
    ...overrides,
  };
}

describe('SuscripcionService.procesarVencimientosManuales', () => {
  const service = new SuscripcionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.usuario.findMany.mockResolvedValue([{ email: 'admin@org.com', nombre: 'Admin' }]);
  });

  it('no hace nada si no hay suscripciones MANUAL activas con periodoFinEn', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([]);

    const resultado = await service.procesarVencimientosManuales();

    expect(resultado).toEqual({ avisados: 0, suspendidos: 0 });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
  });

  it('envía el aviso una vez que se entra en la ventana de avisoDias y marca avisoEnviadoEn', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([
      suscripcionManual({ avisoDias: 5, periodoFinEn: new Date(Date.now() + 3 * DIA_MS) }),
    ]);

    const resultado = await service.procesarVencimientosManuales();

    expect(resultado.avisados).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ to: 'admin@org.com' });
    expect(mockPrisma.suscripcion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ avisoEnviadoEn: expect.any(Date) }),
      })
    );
  });

  it('no avisa todavía si faltan más días de los configurados en avisoDias', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([
      suscripcionManual({ avisoDias: 5, periodoFinEn: new Date(Date.now() + 20 * DIA_MS) }),
    ]);

    const resultado = await service.procesarVencimientosManuales();

    expect(resultado.avisados).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('no reenvía el aviso si avisoEnviadoEn ya está marcado para este periodo', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([
      suscripcionManual({
        avisoDias: 5,
        periodoFinEn: new Date(Date.now() + 1 * DIA_MS),
        avisoEnviadoEn: new Date(),
      }),
    ]);

    const resultado = await service.procesarVencimientosManuales();

    expect(resultado.avisados).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
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
