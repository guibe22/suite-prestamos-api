import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Foto de la cédula: habilitada por organización solo desde el panel de
 * plataforma, scoped por ruta (Zero-Route) y limitada a JPEG comprimido.
 */

const mockTx = {
  fotoCedulaCliente: { upsert: vi.fn() },
  auditoria: { create: vi.fn() },
};

const mockPrisma = {
  organizacion: { findUnique: vi.fn() },
  cliente: { findFirst: vi.fn() },
  fotoCedulaCliente: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  auditoria: { create: vi.fn() },
  $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockTx) : Promise.all(arg))),
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));

const { ClienteFotoService, MAX_BYTES_FOTO_CEDULA } = await import('../cliente-foto.service.js');

/** JPEG mínimo: solo importa la firma FF D8 FF para la validación. */
function jpegBase64(bytes = 2000): string {
  const buf = Buffer.alloc(bytes, 0x11);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf.toString('base64');
}

describe('ClienteFotoService', () => {
  const service = new ClienteFotoService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.organizacion.findUnique.mockResolvedValue({ permiteFotoCedula: true });
    mockPrisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1' });
    mockPrisma.fotoCedulaCliente.findUnique.mockResolvedValue(null);
    mockTx.fotoCedulaCliente.upsert.mockResolvedValue({ bytes: 2000, updatedAt: new Date() });
  });

  it('rechaza subir si la plataforma no habilitó la función para la organización', async () => {
    mockPrisma.organizacion.findUnique.mockResolvedValue({ permiteFotoCedula: false });
    await expect(service.guardar('org-1', 'cli-1', jpegBase64(), 'u-1', 'ADMIN')).rejects.toThrow(/no está habilitada/);
    expect(mockTx.fotoCedulaCliente.upsert).not.toHaveBeenCalled();
  });

  it('rechaza ver si la función está apagada', async () => {
    mockPrisma.organizacion.findUnique.mockResolvedValue({ permiteFotoCedula: false });
    await expect(service.obtener('org-1', 'cli-1', 'u-1', 'ADMIN')).rejects.toThrow(/no está habilitada/);
  });

  it('un COBRADOR solo alcanza clientes de sus rutas', async () => {
    await service.guardar('org-1', 'cli-1', jpegBase64(), 'cob-1', 'COBRADOR');
    const where = mockPrisma.cliente.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'cli-1', organizacionId: 'org-1', deletedAt: null });
    expect(where.ruta).toBeDefined();
  });

  it('un ADMIN alcanza toda la organización (sin filtro de ruta)', async () => {
    await service.guardar('org-1', 'cli-1', jpegBase64(), 'adm-1', 'ADMIN');
    expect(mockPrisma.cliente.findFirst.mock.calls[0][0].where.ruta).toBeUndefined();
  });

  it('cliente de otra ruta/organización → 404 sin guardar nada', async () => {
    mockPrisma.cliente.findFirst.mockResolvedValue(null);
    await expect(service.guardar('org-1', 'cli-x', jpegBase64(), 'cob-1', 'COBRADOR')).rejects.toThrow(/no existe/);
    expect(mockTx.fotoCedulaCliente.upsert).not.toHaveBeenCalled();
  });

  it('rechaza lo que no es JPEG (ej. PNG)', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).toString('base64');
    await expect(service.guardar('org-1', 'cli-1', png, 'u-1', 'ADMIN')).rejects.toThrow(/JPEG/);
  });

  it('rechaza una foto sin comprimir que pase el tope', async () => {
    await expect(
      service.guardar('org-1', 'cli-1', jpegBase64(MAX_BYTES_FOTO_CEDULA + 1), 'u-1', 'ADMIN')
    ).rejects.toThrow(/máximo/);
  });

  it('guarda con upsert y deja auditoría sin la imagen', async () => {
    await service.guardar('org-1', 'cli-1', jpegBase64(2000), 'u-1', 'ADMIN');
    expect(mockTx.fotoCedulaCliente.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clienteId: 'cli-1' },
        create: expect.objectContaining({ organizacionId: 'org-1', bytes: 2000, subidaPor: 'u-1' }),
      })
    );
    const audit = mockTx.auditoria.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ accion: 'CREATE', tabla: 'foto_cedula_cliente', registroId: 'cli-1' });
    expect(JSON.stringify(audit)).not.toContain('imagenBase64');
  });

  it('se puede borrar aunque la plataforma ya haya apagado la función', async () => {
    mockPrisma.organizacion.findUnique.mockResolvedValue({ permiteFotoCedula: false });
    mockPrisma.fotoCedulaCliente.findFirst.mockResolvedValue({ bytes: 1234 });
    await service.eliminar('org-1', 'cli-1', 'u-1', 'ADMIN');
    expect(mockPrisma.fotoCedulaCliente.delete).toHaveBeenCalledWith({ where: { clienteId: 'cli-1' } });
  });
});
