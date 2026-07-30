import { describe, it, expect, vi, beforeEach } from 'vitest';

const DIA_MS = 24 * 60 * 60 * 1000;

const mockPrisma = {
  suscripcion: { findUnique: vi.fn(), update: vi.fn() },
  configuracionSistema: { upsert: vi.fn() },
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));

const { SuscripcionService } = await import('../suscripcion.service.js');

function suscripcionManual(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    organizacionId: 'org-1',
    proveedor: 'MANUAL',
    estado: 'ACTIVA',
    trialTerminaEn: null,
    canceladaEn: null,
    diasGraciaSuspension: null,
    periodoFinEn: new Date(Date.now() + 10 * DIA_MS),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * `evaluarYAplicarVencimientoManual` (privado, invocado desde
 * obtenerNivelAcceso) es el chequeo perezoso: aparte del cron diario
 * (suscripcion-vencimiento.worker.ts), cada vez que la app llama a
 * /mi-suscripcion se reevalúa el vencimiento MANUAL en el momento, para no
 * depender de que ya haya corrido la corrida de las 3:30am.
 */
describe('SuscripcionService.obtenerNivelAcceso — vencimiento manual perezoso', () => {
  const service = new SuscripcionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.configuracionSistema.upsert.mockResolvedValue({
      soporteTelefono: null,
      soporteEmail: null,
      suscripcionGraciaDias: 7,
    });
  });

  it('todavía no vence: nivel ACTIVO, no toca el estado ni informa gracia manual', async () => {
    const sub = suscripcionManual({ periodoFinEn: new Date(Date.now() + 5 * DIA_MS) });
    mockPrisma.suscripcion.findUnique.mockResolvedValue(sub);

    const resultado = await service.obtenerNivelAcceso('org-1');

    expect(resultado.nivel).toBe('ACTIVO');
    expect(resultado.diasRestantesGraciaManual).toBeNull();
    expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
  });

  it('vencida y sin días de gracia propios: se suspende de inmediato, sin esperar al cron', async () => {
    const sub = suscripcionManual({
      diasGraciaSuspension: null,
      periodoFinEn: new Date(Date.now() - 1 * DIA_MS),
    });
    mockPrisma.suscripcion.findUnique.mockResolvedValue(sub);
    mockPrisma.suscripcion.update.mockImplementation(({ data }) => Promise.resolve({ ...sub, ...data }));

    const resultado = await service.obtenerNivelAcceso('org-1');

    expect(mockPrisma.suscripcion.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { estado: 'SUSPENDIDA', updatedAt: expect.any(Date) },
    });
    expect(resultado.diasRestantesGraciaManual).toBeNull();
    expect(resultado.nivel).not.toBe('ACTIVO');
  });

  it('si se detecta la suspensión mucho después del vencimiento real, la gracia global no arranca de cero', async () => {
    // Debió suspenderse hace 30 días (periodoFinEn + 0 de gracia propia), pero
    // nadie abrió la app hasta ahora — sin fijar `updatedAt` a ese momento
    // real, fechaInicioBloqueo() lo tomaría como "ahora" y regalaría una
    // gracia global (7 días) completa e injustificada.
    const finGraciaReal = Date.now() - 30 * DIA_MS;
    const sub = suscripcionManual({
      diasGraciaSuspension: 0,
      periodoFinEn: new Date(finGraciaReal),
    });
    mockPrisma.suscripcion.findUnique.mockResolvedValue(sub);
    mockPrisma.suscripcion.update.mockImplementation(({ data }) => Promise.resolve({ ...sub, ...data }));

    const resultado = await service.obtenerNivelAcceso('org-1');

    const llamada = mockPrisma.suscripcion.update.mock.calls[0][0];
    expect(llamada.data.updatedAt.getTime()).toBe(finGraciaReal);
    expect(resultado.nivel).toBe('BLOQUEADO');
  });

  it('vencida pero dentro de su propia diasGraciaSuspension: sigue ACTIVA e informa los días restantes', async () => {
    const sub = suscripcionManual({
      diasGraciaSuspension: 3,
      periodoFinEn: new Date(Date.now() - 1 * DIA_MS),
    });
    mockPrisma.suscripcion.findUnique.mockResolvedValue(sub);

    const resultado = await service.obtenerNivelAcceso('org-1');

    expect(mockPrisma.suscripcion.update).not.toHaveBeenCalled();
    expect(resultado.nivel).toBe('ACTIVO');
    expect(resultado.diasRestantesGraciaManual).toBe(2);
  });
});
