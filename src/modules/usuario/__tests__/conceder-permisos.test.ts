import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El módulo de equipo dejó de exigir rol ADMIN y pasó a pedir el permiso
 * `equipo:gestionar` (usuario.routes.ts). Eso abre dos caminos de escalada que
 * el servicio tiene que cerrar: invitar a alguien —o a uno mismo con otro
 * correo— como ADMIN, y regalar permisos que el actor no posee.
 */

const mockPrisma = {
  usuario: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  rol: { findUnique: vi.fn(), create: vi.fn() },
  suscripcion: { findUnique: vi.fn() },
  cliente: { count: vi.fn() },
  ruta: { count: vi.fn() },
  prestamo: { count: vi.fn() },
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../shared/email/email.service.js', () => ({ sendEmail: vi.fn() }));

const { UsuarioService } = await import('../usuario.service.js');

const GERENTE = { rol: 'GERENTE', permisos: ['clientes:ver', 'equipo:gestionar'] };
const ADMIN = { rol: 'ADMIN', permisos: null };

describe('UsuarioService: lo que un no-administrador puede conceder', () => {
  const service = new UsuarioService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('impide invitar a alguien como ADMIN', async () => {
    await expect(
      service.crear(
        'org-1',
        { nombre: 'Nuevo', email: 'nuevo@ejemplo.com', rol: 'ADMIN' },
        GERENTE
      )
    ).rejects.toThrow(/administrador/i);

    expect(mockPrisma.usuario.create).not.toHaveBeenCalled();
  });

  it('impide conceder un permiso que el actor no tiene', async () => {
    await expect(
      service.crear(
        'org-1',
        {
          nombre: 'Nuevo',
          email: 'nuevo@ejemplo.com',
          rol: 'COBRADOR',
          permisos: ['clientes:ver', 'pagos:eliminar'],
        },
        GERENTE
      )
    ).rejects.toThrow(/pagos:eliminar/);
  });

  it('impide escalar permisos a un miembro ya existente', async () => {
    await expect(
      service.actualizar(
        'org-1',
        'miembro-1',
        'actor-1',
        { permisos: ['equipo:gestionar', 'prestamos:eliminar'] },
        GERENTE
      )
    ).rejects.toThrow(/prestamos:eliminar/);
  });

  it('deja conceder lo que el propio actor sí tiene', async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue(null);
    mockPrisma.suscripcion.findUnique.mockResolvedValue({ plan: { limites: { maxUsuarios: null } } });
    mockPrisma.rol.findUnique.mockResolvedValue({ id: 'rol-1', nombre: 'COBRADOR' });
    mockPrisma.usuario.create.mockResolvedValue({
      id: 'u-1',
      nombre: 'Nuevo',
      email: 'nuevo@ejemplo.com',
      rol: { nombre: 'COBRADOR' },
      permisos: ['clientes:ver'],
      deletedAt: null,
      password: null,
      invitacionAceptadaEn: null,
      createdAt: new Date(),
    });

    await expect(
      service.crear(
        'org-1',
        { nombre: 'Nuevo', email: 'nuevo@ejemplo.com', rol: 'COBRADOR', permisos: ['clientes:ver'] },
        GERENTE
      )
    ).resolves.toMatchObject({ email: 'nuevo@ejemplo.com' });
  });

  it('no limita a un administrador', async () => {
    mockPrisma.usuario.findUnique.mockResolvedValue(null);
    mockPrisma.suscripcion.findUnique.mockResolvedValue({ plan: { limites: { maxUsuarios: null } } });
    mockPrisma.rol.findUnique.mockResolvedValue({ id: 'rol-2', nombre: 'GERENTE' });
    mockPrisma.usuario.create.mockResolvedValue({
      id: 'u-2',
      nombre: 'Jefa',
      email: 'jefa@ejemplo.com',
      rol: { nombre: 'GERENTE' },
      permisos: ['pagos:eliminar'],
      deletedAt: null,
      password: null,
      invitacionAceptadaEn: null,
      createdAt: new Date(),
    });

    await expect(
      service.crear(
        'org-1',
        { nombre: 'Jefa', email: 'jefa@ejemplo.com', rol: 'GERENTE', permisos: ['pagos:eliminar'] },
        ADMIN
      )
    ).resolves.toMatchObject({ rol: 'GERENTE' });
  });
});
