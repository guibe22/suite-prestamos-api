import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  usuario: { findUnique: vi.fn(), create: vi.fn() },
  cuenta: { create: vi.fn() },
  organizacion: { create: vi.fn() },
  rol: { findUnique: vi.fn() },
  plan: { findFirst: vi.fn() },
  suscripcion: { create: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../utils/jwt.js', () => ({
  generateAccessToken: vi.fn(() => 'mock-access-token'),
  generateRefreshToken: vi.fn(() => 'mock-refresh-token'),
  verifyRefreshToken: vi.fn(),
}));

const { AuthService } = await import('../auth.service.js');

describe('AuthService.googleAuth', () => {
  const service = new AuthService();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch para Google tokeninfo / userinfo
    global.fetch = vi.fn() as any;
  });

  it('vincula automáticamente un usuario ya existente en producción sin pedir contraseña', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        email: 'wilber@gmail.com',
        email_verified: 'true',
        name: 'Wilber Gálvez',
        sub: 'google-sub-123',
      }),
    });

    const usuarioExistente = {
      id: 'usr-1',
      nombre: 'Wilber Gálvez',
      email: 'wilber@gmail.com',
      password: 'hashed-password-antiguo',
      rol: { nombre: 'ADMIN' },
      organizacionId: 'org-1',
      organizacion: {
        id: 'org-1',
        nombre: 'Mi Empresa SRL',
        identificacionTributaria: null,
        direccion: null,
        telefono: null,
        configuracion: { moneda: 'DOP' },
      },
      deletedAt: null,
    };

    mockPrisma.usuario.findUnique.mockResolvedValueOnce(usuarioExistente);

    const session = await service.googleAuth({ idToken: 'valid-google-id-token' });

    expect(session.id).toBe('usr-1');
    expect(session.email).toBe('wilber@gmail.com');
    expect(session.organizacionId).toBe('org-1');
    expect(session.tokens.accessToken).toBe('mock-access-token');
    // No se llamó a crear nuevo usuario ni organización
    expect(mockPrisma.usuario.create).not.toHaveBeenCalled();
    expect(mockPrisma.organizacion.create).not.toHaveBeenCalled();
  });

  it('crea usuario nuevo con password nulo y trial automático si no existía previamente', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        email: 'nuevo@gmail.com',
        email_verified: true,
        name: 'Nuevo Cliente',
        sub: 'google-sub-456',
      }),
    });

    mockPrisma.usuario.findUnique.mockResolvedValueOnce(null); // No existe
    mockPrisma.rol.findUnique.mockResolvedValueOnce({ id: 'rol-admin', nombre: 'ADMIN' });
    mockPrisma.cuenta.create.mockResolvedValueOnce({ id: 'cta-1', nombre: 'Cuenta de Nuevo Cliente' });
    mockPrisma.organizacion.create.mockResolvedValueOnce({ id: 'org-nuevo', nombre: 'Organización de Nuevo Cliente', configuracion: null });
    mockPrisma.usuario.create.mockResolvedValueOnce({
      id: 'usr-nuevo',
      nombre: 'Nuevo Cliente',
      email: 'nuevo@gmail.com',
      password: null, // password queda nulo
      rol: { nombre: 'ADMIN' },
      organizacionId: 'org-nuevo',
      organizacion: { id: 'org-nuevo', nombre: 'Organización de Nuevo Cliente', configuracion: null },
    });
    mockPrisma.plan.findFirst.mockResolvedValueOnce({ id: 'plan-free', diasTrial: 14 });
    mockPrisma.suscripcion.create.mockResolvedValueOnce({});

    const session = await service.googleAuth({ idToken: 'valid-google-id-token-nuevo' });

    expect(session.id).toBe('usr-nuevo');
    expect(session.email).toBe('nuevo@gmail.com');
    expect(session.organizacionId).toBe('org-nuevo');
    expect(mockPrisma.usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'nuevo@gmail.com',
          password: null,
        }),
      })
    );
    expect(mockPrisma.suscripcion.create).toHaveBeenCalled();
  });

  it('informa amigablemente si un usuario registrado con Google intenta iniciar sesión con email y contraseña vacía o incorrecta', async () => {
    const usuarioGoogle = {
      id: 'usr-google',
      nombre: 'Cliente Google',
      email: 'cliente@gmail.com',
      password: null, // No tiene contraseña
      rol: { nombre: 'ADMIN' },
      organizacionId: 'org-1',
      invitacionToken: null,
      deletedAt: null,
    };

    mockPrisma.usuario.findUnique.mockResolvedValueOnce(usuarioGoogle);

    await expect(
      service.login({ email: 'cliente@gmail.com', password: 'password123' })
    ).rejects.toThrow(/registrada con Google/i);
  });
});
