import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Un anuncio de plataforma es la operación con más alcance de todo el sistema:
 * un error acá le llega a todos los usuarios de todas las organizaciones. Lo
 * que importa probar es a quién alcanza, a quién no, y que un fallo aislado no
 * cancele el resto.
 */

const mockPrisma = {
  organizacion: { findFirst: vi.fn(), findMany: vi.fn() },
  usuario: { findMany: vi.fn() },
  dispositivoPush: { count: vi.fn() },
  notificacion: { count: vi.fn(), findMany: vi.fn() },
};

/** Forma mínima del input que recibe crearYEnviar, para no recurrir a `any`. */
interface EntradaNotificacion {
  organizacionId: string;
  usuarioId: string | null;
  categoria: string;
  titulo: string;
  cuerpo: string;
  data?: Record<string, unknown>;
  claveIdempotencia?: string;
}

const crearYEnviar = vi.fn(async (_input: EntradaNotificacion) => true);

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../notificacion/notificacion.service.js', () => ({
  NotificacionService: class {
    crearYEnviar = crearYEnviar;
  },
}));

const { AdminNotificacionService } = await import('../admin-notificacion.service.js');
const { NotFoundError, BadRequestError } = await import('../../../shared/errors/custom.error.js');

const anuncio = {
  organizacionId: null,
  categoria: 'SINCRONIZACION' as const,
  titulo: 'Mantenimiento',
  cuerpo: 'El sistema estará en mantenimiento el domingo.',
};

const enviados = (): EntradaNotificacion[] => crearYEnviar.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  crearYEnviar.mockResolvedValue(true);
  mockPrisma.organizacion.findMany.mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]);
  mockPrisma.organizacion.findFirst.mockResolvedValue({ id: 'org-1' });
  mockPrisma.usuario.findMany.mockResolvedValue([
    { id: 'u1', organizacionId: 'org-1' },
    { id: 'u2', organizacionId: 'org-2' },
  ]);
});

describe('enviarAnuncio', () => {
  const service = new AdminNotificacionService();

  it('sin organizacionId alcanza a todas las organizaciones vigentes', async () => {
    const resultado = await service.enviarAnuncio(anuncio);

    expect(mockPrisma.organizacion.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      select: { id: true },
    });
    expect(resultado).toMatchObject({ organizaciones: 2, destinatarios: 2, truncado: false });
  });

  it('con organizacionId se limita a esa sola', async () => {
    mockPrisma.usuario.findMany.mockResolvedValue([{ id: 'u1', organizacionId: 'org-1' }]);

    const resultado = await service.enviarAnuncio({ ...anuncio, organizacionId: 'org-1' });

    expect(mockPrisma.usuario.findMany.mock.calls[0][0].where.organizacionId.in).toEqual(['org-1']);
    expect(resultado.organizaciones).toBe(1);
  });

  it('una organización inexistente da 404 en vez de mandar a todas', async () => {
    mockPrisma.organizacion.findFirst.mockResolvedValue(null);

    await expect(
      service.enviarAnuncio({ ...anuncio, organizacionId: 'no-existe' })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(crearYEnviar).not.toHaveBeenCalled();
  });

  it('sin organizaciones vigentes no manda nada', async () => {
    mockPrisma.organizacion.findMany.mockResolvedValue([]);

    await expect(service.enviarAnuncio(anuncio)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('excluye borrados y a quien tiene la invitación pendiente', async () => {
    await service.enviarAnuncio(anuncio);

    const where = mockPrisma.usuario.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.NOT).toEqual({
      AND: [{ invitacionToken: { not: null } }, { invitacionAceptadaEn: null }],
    });
  });

  it('NO filtra por invitacionAceptadaEn a secas: el dueño de la organización no tiene fecha', async () => {
    // El dueño se registra directo, sin invitación: invitacionToken e
    // invitacionAceptadaEn quedan nulos. Un filtro `invitacionAceptadaEn:
    // { not: null }` lo dejaba fuera de todos los anuncios de plataforma.
    await service.enviarAnuncio(anuncio);

    const where = mockPrisma.usuario.findMany.mock.calls[0][0].where;
    expect(where.invitacionAceptadaEn).toBeUndefined();
  });

  it('crea una fila POR USUARIO: el estado de leído no puede ser compartido', async () => {
    await service.enviarAnuncio(anuncio);

    const destinatarios = enviados().map((e) => e.usuarioId);
    expect(destinatarios).toEqual(['u1', 'u2']);
    expect(enviados().every((e) => e.usuarioId !== null)).toBe(true);
  });

  it('cada usuario lleva el organizacionId de SU organización, no el del primero', async () => {
    await service.enviarAnuncio(anuncio);

    expect(enviados().map((e) => e.organizacionId)).toEqual(['org-1', 'org-2']);
  });

  it('las claves de idempotencia son únicas dentro del anuncio', async () => {
    await service.enviarAnuncio(anuncio);

    const claves = enviados().map((e) => e.claveIdempotencia);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('un fallo en un destinatario no cancela el anuncio para el resto', async () => {
    crearYEnviar.mockRejectedValueOnce(new Error('token roto'));

    const resultado = await service.enviarAnuncio(anuncio);

    expect(crearYEnviar).toHaveBeenCalledTimes(2);
    expect(resultado.destinatarios).toBe(1);
  });

  it('adjunta la ruta del deep link solo si se envió', async () => {
    await service.enviarAnuncio({ ...anuncio, ruta: '/jornada' });
    expect(enviados()[0].data).toEqual({ ruta: '/jornada' });

    crearYEnviar.mockClear();
    await service.enviarAnuncio(anuncio);
    expect(enviados()[0].data).toBeUndefined();
  });

  it('se trunca al tope y lo reporta en vez de callarlo', async () => {
    mockPrisma.usuario.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, (_, i) => ({ id: `u${i}`, organizacionId: 'org-1' }))
    );

    const resultado = await service.enviarAnuncio(anuncio);

    expect(resultado.truncado).toBe(true);
    expect(crearYEnviar).toHaveBeenCalledTimes(5000);
  });
});

describe('diagnostico', () => {
  const service = new AdminNotificacionService();

  beforeEach(() => {
    mockPrisma.dispositivoPush.count.mockResolvedValue(3);
    mockPrisma.notificacion.count.mockResolvedValue(10);
    mockPrisma.notificacion.findMany.mockResolvedValue([]);
    mockPrisma.organizacion.findMany.mockResolvedValue([]);
  });

  it('agrupa dispositivos, entregas y fallos del rango pedido', async () => {
    const datos = (await service.diagnostico(7)) as Record<string, unknown>;

    expect(datos.rangoDias).toBe(7);
    expect(datos.dispositivos).toEqual({ activos: 3, inactivos: 3 });
    expect(datos.notificaciones).toEqual({ total: 10, entregadas: 10, conError: 10 });
  });

  it('rechaza rangos absurdos', async () => {
    await expect(service.diagnostico(0)).rejects.toBeInstanceOf(BadRequestError);
    await expect(service.diagnostico(999)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('busca organizaciones donde NADIE tiene dispositivo activo', async () => {
    await service.diagnostico(7);

    const llamada = mockPrisma.organizacion.findMany.mock.calls.at(-1)?.[0];
    expect(llamada.where.usuarios).toEqual({
      none: { dispositivosPush: { some: { activo: true } } },
    });
  });
});
