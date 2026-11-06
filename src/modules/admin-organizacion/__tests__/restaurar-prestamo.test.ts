import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Restaurar desde el panel de PLATAFORMA un préstamo que la app canceló
 * ("Cancelar préstamo" marca estado CANCELADO): vuelve a ACTIVO, o a
 * LIQUIDADO si ya no debe nada, y el pull lo reenvía a los teléfonos.
 */

const mockTx = {
  cuota: { findMany: vi.fn() },
  prestamo: { update: vi.fn() },
  auditoria: { create: vi.fn() },
};

const mockPrisma = {
  prestamo: { findFirst: vi.fn() },
  $transaction: vi.fn(async (cb: any) => cb(mockTx)),
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../pago/pago.service.js', () => ({ PagoService: class {} }));

const { AdminOrganizacionService } = await import('../admin-organizacion.service.js');

const cancelado = {
  id: 'p1',
  codigo: 'P-000042',
  estado: 'CANCELADO',
  deletedAt: null,
  cliente: { nombres: 'Juan', apellidos: 'Pérez', deletedAt: null },
};

describe('AdminOrganizacionService.restaurarPrestamo', () => {
  const service = new AdminOrganizacionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));
  });

  it('vuelve a ACTIVO si le quedan cuotas por pagar y sube updatedAt', async () => {
    mockPrisma.prestamo.findFirst.mockResolvedValue(cancelado);
    mockTx.cuota.findMany.mockResolvedValue([
      { montoTotal: 1000, montoPagado: 1000 },
      { montoTotal: 1000, montoPagado: 0 },
    ]);

    const r = await service.restaurarPrestamo('org-1', 'p1', 'admin-1');

    expect(r.estado).toBe('ACTIVO');
    expect(mockTx.prestamo.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { estado: 'ACTIVO', updatedAt: expect.any(Date) },
    });
    expect(mockTx.auditoria.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        usuarioId: 'admin-1',
        accion: 'RESTORE',
        tabla: 'prestamos',
        registroId: 'p1',
        valoresAnteriores: { estado: 'CANCELADO' },
        valoresNuevos: { estado: 'ACTIVO' },
      }),
    });
  });

  it('vuelve a LIQUIDADO si todas las cuotas están pagadas', async () => {
    mockPrisma.prestamo.findFirst.mockResolvedValue(cancelado);
    mockTx.cuota.findMany.mockResolvedValue([{ montoTotal: 1000, montoPagado: 1000 }]);

    const r = await service.restaurarPrestamo('org-1', 'p1', 'admin-1');

    expect(r.estado).toBe('LIQUIDADO');
  });

  it('rechaza un préstamo que no está cancelado', async () => {
    mockPrisma.prestamo.findFirst.mockResolvedValue({ ...cancelado, estado: 'ACTIVO' });

    await expect(service.restaurarPrestamo('org-1', 'p1', 'admin-1')).rejects.toThrow('no está cancelado');
    expect(mockTx.prestamo.update).not.toHaveBeenCalled();
  });

  it('pide restaurar primero al cliente si está eliminado', async () => {
    mockPrisma.prestamo.findFirst.mockResolvedValue({
      ...cancelado,
      cliente: { ...cancelado.cliente, deletedAt: new Date() },
    });

    await expect(service.restaurarPrestamo('org-1', 'p1', 'admin-1')).rejects.toThrow('Restaura primero al cliente');
    expect(mockTx.prestamo.update).not.toHaveBeenCalled();
  });

  it('busca el préstamo solo dentro de la organización indicada', async () => {
    mockPrisma.prestamo.findFirst.mockResolvedValue(null);

    await expect(service.restaurarPrestamo('org-1', 'p1', 'admin-1')).rejects.toThrow('no existe');
    expect(mockPrisma.prestamo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', cliente: { organizacionId: 'org-1' }, deletedAt: null } })
    );
  });
});
