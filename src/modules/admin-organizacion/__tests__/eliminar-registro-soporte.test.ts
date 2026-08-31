import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El panel de PLATAFORMA (pestaña "Pagos / Cobros" de una organización) borra
 * pagos por un camino propio, distinto del DELETE directo y del borrado vía
 * sync. Ese camino solo hacía el soft-delete y volteaba LIQUIDADO → ACTIVO:
 * dejaba `cuotas.montoPagado` intacto (cuotas PAGADA con dinero que ya no
 * existe), la mora vieja y el `efectivoCobrado` de la jornada inflado — y sin
 * tocar `cuotas.updatedAt`, ningún dispositivo recibía nunca la corrección.
 * Estas pruebas fijan que ahora reutiliza los mismos recálculos que los otros
 * dos caminos y que deja rastro en Auditoria.
 */

const mockTx = {
  pago: { update: vi.fn(), updateMany: vi.fn() },
  cuota: { updateMany: vi.fn() },
  prestamo: { update: vi.fn() },
  auditoria: { create: vi.fn(), createMany: vi.fn() },
};

const mockPrisma = {
  organizacion: { findUnique: vi.fn() },
  pago: { findFirst: vi.fn(), findMany: vi.fn() },
  prestamo: { findFirst: vi.fn() },
  $transaction: vi.fn(async (cb: any) => cb(mockTx)),
};

const recalcs = {
  recalcularPrestamo: vi.fn(),
  recalcularEfectivoCobradoJornada: vi.fn(),
  recalcularClientesVisitadosJornada: vi.fn(),
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../pago/pago.service.js', () => ({
  PagoService: class {
    recalcularPrestamo = recalcs.recalcularPrestamo;
    recalcularEfectivoCobradoJornada = recalcs.recalcularEfectivoCobradoJornada;
    recalcularClientesVisitadosJornada = recalcs.recalcularClientesVisitadosJornada;
  },
}));

const { AdminOrganizacionService } = await import('../admin-organizacion.service.js');

describe('AdminOrganizacionService.eliminarRegistroSoporte', () => {
  const service = new AdminOrganizacionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));
    mockPrisma.organizacion.findUnique.mockResolvedValue({ id: 'org-1' });
  });

  describe('tipo PAGO', () => {
    const pago = {
      id: 'pg-1',
      prestamoId: 'pr-1',
      jornadaId: 'j-1',
      monto: 1000,
      moraCobrada: 200,
      prestamo: { clienteId: 'cl-1', estado: 'LIQUIDADO' },
    };

    it('recalcula el préstamo y los totales de la jornada, y audita el borrado', async () => {
      mockPrisma.pago.findFirst.mockResolvedValue(pago);

      await service.eliminarRegistroSoporte('org-1', 'PAGO', 'pg-1', 'admin-1');

      expect(mockTx.pago.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pg-1' } })
      );
      // El recálculo recibe el pago eliminado: `recalcularPrestamo` lo necesita
      // para no descontar dos veces la base de cuotas pagadas de inicio.
      expect(recalcs.recalcularPrestamo).toHaveBeenCalledWith(mockTx, 'pr-1', pago);
      expect(recalcs.recalcularEfectivoCobradoJornada).toHaveBeenCalledWith(mockTx, 'j-1');
      expect(recalcs.recalcularClientesVisitadosJornada).toHaveBeenCalledWith(mockTx, 'j-1', 'cl-1');
      expect(mockTx.auditoria.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            usuarioId: 'admin-1',
            accion: 'DELETE',
            tabla: 'pagos',
            registroId: 'pg-1',
          }),
        })
      );
    });

    it('no voltea el estado del préstamo a mano: eso lo decide recalcularPrestamo', async () => {
      mockPrisma.pago.findFirst.mockResolvedValue(pago);

      await service.eliminarRegistroSoporte('org-1', 'PAGO', 'pg-1', 'admin-1');

      // El único update de préstamo permitido en este camino es el que hace
      // recalcularPrestamo (mockeado): la rama LIQUIDADO → ACTIVO ya no existe.
      expect(mockTx.prestamo.update).not.toHaveBeenCalled();
    });

    it('sin jornadaId no intenta recalcular ninguna jornada', async () => {
      mockPrisma.pago.findFirst.mockResolvedValue({ ...pago, jornadaId: null });

      await service.eliminarRegistroSoporte('org-1', 'PAGO', 'pg-1', 'admin-1');

      expect(recalcs.recalcularPrestamo).toHaveBeenCalledOnce();
      expect(recalcs.recalcularEfectivoCobradoJornada).not.toHaveBeenCalled();
      expect(recalcs.recalcularClientesVisitadosJornada).not.toHaveBeenCalled();
    });

    it('rechaza un pago de otra organización (o ya borrado) sin escribir nada', async () => {
      mockPrisma.pago.findFirst.mockResolvedValue(null);

      await expect(service.eliminarRegistroSoporte('org-1', 'PAGO', 'pg-x', 'admin-1')).rejects.toThrow(
        /no fue encontrado/i
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('tipo PRESTAMO', () => {
    it('recalcula los cuadres de todas las jornadas que alimentaban sus pagos (sin duplicar)', async () => {
      mockPrisma.prestamo.findFirst.mockResolvedValue({ id: 'pr-1', clienteId: 'cl-1', estado: 'ACTIVO' });
      mockPrisma.pago.findMany.mockResolvedValue([
        { id: 'pg-1', jornadaId: 'j-1' },
        { id: 'pg-2', jornadaId: 'j-1' },
        { id: 'pg-3', jornadaId: 'j-2' },
        { id: 'pg-4', jornadaId: null },
      ]);

      await service.eliminarRegistroSoporte('org-1', 'PRESTAMO', 'pr-1', 'admin-1');

      expect(recalcs.recalcularEfectivoCobradoJornada).toHaveBeenCalledTimes(2);
      expect(recalcs.recalcularEfectivoCobradoJornada).toHaveBeenCalledWith(mockTx, 'j-1');
      expect(recalcs.recalcularEfectivoCobradoJornada).toHaveBeenCalledWith(mockTx, 'j-2');
      expect(recalcs.recalcularClientesVisitadosJornada).toHaveBeenCalledWith(mockTx, 'j-1', 'cl-1');
      expect(recalcs.recalcularClientesVisitadosJornada).toHaveBeenCalledWith(mockTx, 'j-2', 'cl-1');
      // El préstamo se borra completo: no tiene sentido recalcular sus cuotas.
      expect(recalcs.recalcularPrestamo).not.toHaveBeenCalled();
    });

    it('audita el préstamo y cada uno de los pagos barridos con él', async () => {
      mockPrisma.prestamo.findFirst.mockResolvedValue({ id: 'pr-1', clienteId: 'cl-1', estado: 'ACTIVO' });
      mockPrisma.pago.findMany.mockResolvedValue([{ id: 'pg-1', jornadaId: 'j-1' }]);

      await service.eliminarRegistroSoporte('org-1', 'PRESTAMO', 'pr-1', 'admin-1');

      expect(mockTx.auditoria.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tabla: 'prestamos', registroId: 'pr-1', accion: 'DELETE' }),
        })
      );
      expect(mockTx.auditoria.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ tabla: 'pagos', registroId: 'pg-1', accion: 'DELETE' })],
      });
    });

    it('un préstamo sin pagos no genera auditoría de pagos ni recálculos de jornada', async () => {
      mockPrisma.prestamo.findFirst.mockResolvedValue({ id: 'pr-1', clienteId: 'cl-1', estado: 'ACTIVO' });
      mockPrisma.pago.findMany.mockResolvedValue([]);

      await service.eliminarRegistroSoporte('org-1', 'PRESTAMO', 'pr-1', 'admin-1');

      expect(mockTx.auditoria.createMany).not.toHaveBeenCalled();
      expect(recalcs.recalcularEfectivoCobradoJornada).not.toHaveBeenCalled();
      expect(mockTx.prestamo.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pr-1' } })
      );
    });

    it('solo barre cuotas y pagos que aún estaban vigentes (idempotencia)', async () => {
      mockPrisma.prestamo.findFirst.mockResolvedValue({ id: 'pr-1', clienteId: 'cl-1', estado: 'ACTIVO' });
      mockPrisma.pago.findMany.mockResolvedValue([]);

      await service.eliminarRegistroSoporte('org-1', 'PRESTAMO', 'pr-1', 'admin-1');

      expect(mockTx.cuota.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { prestamoId: 'pr-1', deletedAt: null } })
      );
      expect(mockTx.pago.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { prestamoId: 'pr-1', deletedAt: null } })
      );
    });
  });
});
