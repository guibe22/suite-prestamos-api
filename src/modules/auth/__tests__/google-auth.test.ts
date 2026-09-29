import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = {
  usuario: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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

  it('auto-acepta la invitación de equipo pendiente al iniciar sesión con Google con el mismo correo', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        email: 'cobrador@gmail.com',
        email_verified: true,
        name: 'Cobrador Juan',
        sub: 'google-sub-789',
      }),
    });

    const usuarioInvitado = {
      id: 'usr-invitado',
      nombre: 'Cobrador Juan',
      email: 'cobrador@gmail.com',
      password: null,
      rol: { nombre: 'COBRADOR' },
      organizacionId: 'org-prestamos-1',
      invitacionToken: 'TOKEN123',
      invitacionExpiraEn: new Date(Date.now() + 1000000),
      invitacionAceptadaEn: null,
      organizacion: {
        id: 'org-prestamos-1',
        nombre: 'Financiera Los Socios',
        identificacionTributaria: null,
        direccion: null,
        telefono: null,
        configuracion: { moneda: 'DOP' },
      },
      deletedAt: null,
    };

    const usuarioActualizado = {
      ...usuarioInvitado,
      invitacionToken: null,
      invitacionExpiraEn: null,
      invitacionAceptadaEn: new Date(),
    };

    mockPrisma.usuario.findUnique.mockResolvedValueOnce(usuarioInvitado);
    mockPrisma.usuario.update.mockResolvedValueOnce(usuarioActualizado);

    const session = await service.googleAuth({ idToken: 'valid-token' });

    expect(session.id).toBe('usr-invitado');
    expect(session.rol).toBe('COBRADOR');
    expect(session.organizacionId).toBe('org-prestamos-1');
    expect(mockPrisma.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'usr-invitado' },
        data: expect.objectContaining({
          invitacionToken: null,
          invitacionExpiraEn: null,
        }),
      })
    );
  });

  it('rechaza con error si la invitación pendiente ha expirado', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        email: 'vencido@gmail.com',
        email_verified: true,
        name: 'Cobrador Vencido',
        sub: 'google-sub-expired',
      }),
    });

    const usuarioExpirado = {
      id: 'usr-expirado',
      nombre: 'Cobrador Vencido',
      email: 'vencido@gmail.com',
      password: null,
      rol: { nombre: 'COBRADOR' },
      organizacionId: 'org-prestamos-1',
      invitacionToken: 'TOKEN_EXP',
      invitacionExpiraEn: new Date(Date.now() - 5000), // Expirado en el pasado
      invitacionAceptadaEn: null,
      deletedAt: null,
    };

    mockPrisma.usuario.findUnique.mockResolvedValueOnce(usuarioExpirado);

    await expect(
      service.googleAuth({ idToken: 'valid-token' })
    ).rejects.toThrow(/invitación ha expirado/i);
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
