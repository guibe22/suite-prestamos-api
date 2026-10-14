import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Restaurar clientes borrados desde el panel de PLATAFORMA. Caso que lo
 * motivó: Rosa Elena González, borrada con un préstamo activo de 12 cuotas
 * pendientes que quedó huérfano (invisible en la app, acumulando mora).
 */

const mockTx = {
  cliente: { update: vi.fn() },
  auditoria: { create: vi.fn() },
};

const mockPrisma = {
  organizacion: { findUnique: vi.fn() },
  cliente: { findFirst: vi.fn(), findMany: vi.fn() },
  usuario: { findMany: vi.fn() },
  $transaction: vi.fn(async (cb: any) => cb(mockTx)),
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../pago/pago.service.js', () => ({ PagoService: class {} }));

const { AdminOrganizacionService } = await import('../admin-organizacion.service.js');

const borradoEl = new Date('2026-08-18T10:58:06.579Z');
const rosa = {
  id: 'rosa',
  codigo: 'C-000025',
  nombres: 'Rosa Elena',
  apellidos: 'González',
  deletedAt: borradoEl,
  deletedBy: 'cobrador-1',
  ruta: { nombre: 'Altamira Villa Gonzalez', deletedAt: null },
};

describe('AdminOrganizacionService.restaurarCliente', () => {
  const service = new AdminOrganizacionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));
  });

  it('quita la marca de borrado y sube updatedAt para que el pull lo reenvíe', async () => {
    mockPrisma.cliente.findFirst.mockResolvedValue(rosa);

    const r = await service.restaurarCliente('org-1', 'rosa', 'admin-1');

    expect(mockTx.cliente.update).toHaveBeenCalledWith({
      where: { id: 'rosa' },
      data: { deletedAt: null, deletedBy: null, updatedAt: expect.any(Date) },
    });
    expect(r.codigo).toBe('C-000025');
  });

  it('deja rastro en Auditoria con quién restauró y el borrado anterior', async () => {
    mockPrisma.cliente.findFirst.mockResolvedValue(rosa);

    await service.restaurarCliente('org-1', 'rosa', 'admin-1');

    expect(mockTx.auditoria.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        usuarioId: 'admin-1',
        accion: 'RESTORE',
        tabla: 'clientes',
        registroId: 'rosa',
        valoresAnteriores: { deletedAt: borradoEl.toISOString(), deletedBy: 'cobrador-1' },
      }),
    });
  });

  it('busca el cliente solo dentro de la organización indicada', async () => {
    mockPrisma.cliente.findFirst.mockResolvedValue(null);

    await expect(service.restaurarCliente('org-1', 'rosa', 'admin-1')).rejects.toThrow('no existe');
    expect(mockPrisma.cliente.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rosa', organizacionId: 'org-1' } })
    );
    expect(mockTx.cliente.update).not.toHaveBeenCalled();
  });

  it('rechaza restaurar un cliente que no está borrado', async () => {
    mockPrisma.cliente.findFirst.mockResolvedValue({ ...rosa, deletedAt: null });

    await expect(service.restaurarCliente('org-1', 'rosa', 'admin-1')).rejects.toThrow('no está eliminado');
    expect(mockTx.cliente.update).not.toHaveBeenCalled();
  });

  it('rechaza restaurar si su ruta también está borrada', async () => {
    mockPrisma.cliente.findFirst.mockResolvedValue({ ...rosa, ruta: { nombre: 'Ruta X', deletedAt: new Date() } });

    await expect(service.restaurarCliente('org-1', 'rosa', 'admin-1')).rejects.toThrow('ruta');
    expect(mockTx.cliente.update).not.toHaveBeenCalled();
  });
});

describe('AdminOrganizacionService.listarClientesEliminados', () => {
  const service = new AdminOrganizacionService();

  beforeEach(() => vi.clearAllMocks());

  it('marca los préstamos activos huérfanos y su saldo pendiente', async () => {
    mockPrisma.organizacion.findUnique.mockResolvedValue({ id: 'org-1' });
    mockPrisma.usuario.findMany.mockResolvedValue([{ id: 'cobrador-1', nombre: 'Cobrador Uno' }]);
    mockPrisma.cliente.findMany.mockResolvedValue([
      {
        ...rosa,
        identificacion: null,
        telefono: null,
        prestamos: [
          {
            codigo: 'P-000042',
            cuotas: [
              { montoTotal: 200, montoPagado: 200 },
              { montoTotal: 200, montoPagado: 0 },
              { montoTotal: 200, montoPagado: 50 },
            ],
          },
        ],
      },
    ]);

    const [c] = await service.listarClientesEliminados('org-1');

    expect(c.nombre).toBe('Rosa Elena González');
    expect(c.eliminadoPor).toBe('Cobrador Uno');
    expect(c.prestamosActivos).toEqual(['P-000042']);
    expect(c.saldoPendiente).toBe(350);
  });
});
