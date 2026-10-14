import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/database.js', () => ({ prisma: {} }));

const { SincronizacionService } = await import('../sincronizacion.service.js');

// Método `private`: se accede vía `as any` igual que en los tests vecinos.
const service = new SincronizacionService() as any;

function crearTx(conPrestamosActivos: { id: string; codigo: string }[]) {
  return {
    cliente: {
      findMany: vi.fn().mockResolvedValue(conPrestamosActivos),
      updateMany: vi.fn().mockResolvedValue({ count: conPrestamosActivos.length }),
    },
  };
}

describe('SincronizacionService — borrado de clientes con préstamos activos', () => {
  it('descarta solo el borrado de los clientes con préstamos activos', async () => {
    const tx = crearTx([{ id: 'rosa', codigo: 'C-000025' }]);

    const borrables = await service.descartarBorradoDeClientesConPrestamosActivos(tx, ['rosa', 'otro'], [], 'org-1');

    expect(borrables).toEqual(['otro']);
  });

  it('le sube el updatedAt al cliente protegido para que el pull se lo devuelva al dispositivo', async () => {
    const tx = crearTx([{ id: 'rosa', codigo: 'C-000025' }]);

    await service.descartarBorradoDeClientesConPrestamosActivos(tx, ['rosa'], [], 'org-1');

    expect(tx.cliente.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['rosa'] } },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('busca solo préstamos vigentes, no liquidados/cancelados ni borrados en este mismo push', async () => {
    const tx = crearTx([]);

    await service.descartarBorradoDeClientesConPrestamosActivos(tx, ['c1'], ['p-borrado'], 'org-1');

    expect(tx.cliente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizacionId: 'org-1',
          prestamos: {
            some: {
              deletedAt: null,
              estado: { notIn: ['LIQUIDADO', 'CANCELADO'] },
              id: { notIn: ['p-borrado'] },
            },
          },
        }),
      })
    );
  });

  it('sin préstamos activos deja borrar todo y no toca nada', async () => {
    const tx = crearTx([]);

    const borrables = await service.descartarBorradoDeClientesConPrestamosActivos(tx, ['a', 'b'], [], 'org-1');

    expect(borrables).toEqual(['a', 'b']);
    expect(tx.cliente.updateMany).not.toHaveBeenCalled();
  });
});
