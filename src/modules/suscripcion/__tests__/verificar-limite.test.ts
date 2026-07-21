import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  suscripcion: { findUnique: vi.fn() },
  usuario: { count: vi.fn() },
  cliente: { count: vi.fn() },
  ruta: { count: vi.fn() },
  prestamo: { count: vi.fn() },
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));

const { SuscripcionService } = await import('../suscripcion.service.js');

describe('SuscripcionService.verificarLimite', () => {
  const service = new SuscripcionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.usuario.count.mockResolvedValue(0);
    mockPrisma.cliente.count.mockResolvedValue(0);
    mockPrisma.ruta.count.mockResolvedValue(0);
    mockPrisma.prestamo.count.mockResolvedValue(0);
  });

  it('no consulta nada si el incremento es 0 o negativo', async () => {
    await service.verificarLimite('org-1', 'rutas', 0);
    expect(mockPrisma.suscripcion.findUnique).not.toHaveBeenCalled();
  });

  it('no bloquea si el límite del plan es null (sin límite)', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue({ plan: { limites: { maxRutas: null } } });
    mockPrisma.ruta.count.mockResolvedValue(999);

    await expect(service.verificarLimite('org-1', 'rutas', 100)).resolves.toBeUndefined();
  });

  it('permite crear hasta llegar exactamente al límite', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue({ plan: { limites: { maxRutas: 2 } } });
    mockPrisma.ruta.count.mockResolvedValue(1);

    await expect(service.verificarLimite('org-1', 'rutas', 1)).resolves.toBeUndefined();
  });

  it('rechaza con ForbiddenError si excede el límite del plan', async () => {
    mockPrisma.suscripcion.findUnique.mockResolvedValue({ plan: { limites: { maxRutas: 2 } } });
    mockPrisma.ruta.count.mockResolvedValue(2);

    await expect(service.verificarLimite('org-1', 'rutas', 1)).rejects.toThrow(/límite/i);
  });

  it(
    'sin fila de Suscripcion, verificarLimite por sí solo NO bloquea — depende de que ' +
      'requireActiveSubscription (gateado por ConfiguracionSistema) rechace la petición antes. ' +
      'Si algún día se desacopla esa suposición, este test debe fallar y avisarlo.',
    async () => {
      mockPrisma.suscripcion.findUnique.mockResolvedValue(null);
      await expect(service.verificarLimite('org-1', 'rutas', 999)).resolves.toBeUndefined();
    }
  );
});
