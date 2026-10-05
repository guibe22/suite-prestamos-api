import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Lo que de verdad hay que blindar acá es el ALCANCE: que la bandeja nunca
 * devuelva ni modifique una notificación de otro usuario u otra organización.
 * El push de sincronización ya tuvo un IDOR por confiar en ids del cliente
 * (ver scope-multi-tenant.test.ts); estas pruebas existen para que el módulo
 * nuevo no repita la historia.
 */

const mockPrisma = {
  notificacion: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  dispositivoPush: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  preferenciaNotificacion: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  usuario: { findMany: vi.fn() },
};

const enviarPushMock = vi.fn();

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../shared/push/expo-push.client.js', () => ({
  enviarPush: enviarPushMock,
}));

const { NotificacionService } = await import('../notificacion.service.js');
const { NotFoundError } = await import('../../../shared/errors/custom.error.js');

const ORG = 'org-1';
const YO = 'usuario-1';
const OTRO = 'usuario-2';

describe('alcance multi-tenant de la bandeja', () => {
  const service = new NotificacionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.notificacion.findMany.mockResolvedValue([]);
    mockPrisma.notificacion.count.mockResolvedValue(0);
  });

  it('listar filtra por organización Y por destinatario', async () => {
    await service.listar({ organizacionId: ORG, usuarioId: YO });

    const where = mockPrisma.notificacion.findMany.mock.calls[0][0].where;
    expect(where.organizacionId).toBe(ORG);
    // Lo suyo, o lo dirigido a toda la organización. Nunca lo de otro usuario.
    expect(where.OR).toEqual([{ usuarioId: YO }, { usuarioId: null }]);
  });

  it('marcarLeida nunca modifica por id suelto: siempre con el filtro de visibilidad', async () => {
    mockPrisma.notificacion.updateMany.mockResolvedValue({ count: 1 });

    await service.marcarLeida(ORG, YO, 'notif-1');

    const where = mockPrisma.notificacion.updateMany.mock.calls[0][0].where;
    expect(where.id).toBe('notif-1');
    expect(where.organizacionId).toBe(ORG);
    expect(where.OR).toEqual([{ usuarioId: YO }, { usuarioId: null }]);
  });

  it('marcar como leída una notificación ajena da 404, no la toca', async () => {
    mockPrisma.notificacion.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.notificacion.findFirst.mockResolvedValue(null); // no visible para él

    await expect(service.marcarLeida(ORG, YO, 'notif-de-otro')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('una notificación ya leída no es un error', async () => {
    mockPrisma.notificacion.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.notificacion.findFirst.mockResolvedValue({ id: 'notif-1' }); // existe y es suya

    await expect(service.marcarLeida(ORG, YO, 'notif-1')).resolves.toBeUndefined();
  });

  it('marcarTodasLeidas se acota al usuario, no barre la organización', async () => {
    mockPrisma.notificacion.updateMany.mockResolvedValue({ count: 3 });

    await service.marcarTodasLeidas(ORG, YO);

    const where = mockPrisma.notificacion.updateMany.mock.calls[0][0].where;
    expect(where.organizacionId).toBe(ORG);
    expect(where.OR).toEqual([{ usuarioId: YO }, { usuarioId: null }]);
    expect(where.leidaEn).toBeNull();
  });

  it('el cursor de paginación pide uno de más para saber si hay página siguiente', async () => {
    mockPrisma.notificacion.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ id: `n-${i}` }))
    );

    const resultado = await service.listar({ organizacionId: ORG, usuarioId: YO, limite: 20 });

    expect(mockPrisma.notificacion.findMany.mock.calls[0][0].take).toBe(21);
    expect(resultado.items).toHaveLength(20);
    expect(resultado.siguienteCursor).toBe('n-19');
  });

  it('sin página siguiente el cursor es null', async () => {
    mockPrisma.notificacion.findMany.mockResolvedValue([{ id: 'n-0' }]);

    const resultado = await service.listar({ organizacionId: ORG, usuarioId: YO, limite: 20 });

    expect(resultado.siguienteCursor).toBeNull();
  });

  it('el límite se topa aunque el cliente pida más', async () => {
    await service.listar({ organizacionId: ORG, usuarioId: YO, limite: 9999 });
    expect(mockPrisma.notificacion.findMany.mock.calls[0][0].take).toBe(51); // 50 + 1
  });
});

describe('dispositivos', () => {
  const service = new NotificacionService();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.dispositivoPush.upsert.mockResolvedValue({ id: 'disp-1' });
  });

  it('el upsert es por token, no por usuario: un teléfono compartido se REASIGNA', async () => {
    await service.registrarDispositivo({
      usuarioId: OTRO,
      token: 'ExponentPushToken[abc]',
      plataforma: 'android',
    });

    const llamada = mockPrisma.dispositivoPush.upsert.mock.calls[0][0];
    expect(llamada.where).toEqual({ token: 'ExponentPushToken[abc]' });
    // Si el token ya existía para otro usuario, pasa a ser del nuevo.
    expect(llamada.update.usuarioId).toBe(OTRO);
    expect(llamada.update.activo).toBe(true);
  });

  it('dar de baja exige que el token sea del usuario del JWT', async () => {
    mockPrisma.dispositivoPush.updateMany.mockResolvedValue({ count: 0 });

    await service.darDeBajaDispositivo(YO, 'ExponentPushToken[de-otro]');

    expect(mockPrisma.dispositivoPush.updateMany).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[de-otro]', usuarioId: YO },
      data: { activo: false },
    });
  });
});

describe('creación idempotente y envío', () => {
  const service = new NotificacionService();

  const base = {
    organizacionId: ORG,
    usuarioId: YO,
    categoria: 'JORNADA' as const,
    titulo: 'Jornada cerrada',
    cuerpo: 'Resumen',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.notificacion.findUnique.mockResolvedValue(null);
    mockPrisma.notificacion.create.mockResolvedValue({ id: 'notif-1' });
    mockPrisma.notificacion.update.mockResolvedValue({});
    mockPrisma.preferenciaNotificacion.findMany.mockResolvedValue([]);
    mockPrisma.dispositivoPush.findMany.mockResolvedValue([{ token: 'ExponentPushToken[abc]' }]);
    mockPrisma.dispositivoPush.updateMany.mockResolvedValue({ count: 0 });
    enviarPushMock.mockResolvedValue([{ token: 'ExponentPushToken[abc]', ok: true }]);
  });

  it('no vuelve a crear si la clave de idempotencia ya existe', async () => {
    mockPrisma.notificacion.findUnique.mockResolvedValue({ id: 'ya-estaba' });

    const creada = await service.crearYEnviar({ ...base, claveIdempotencia: 'jornada-cerrada:j1:u1' });

    expect(creada).toBe(false);
    expect(mockPrisma.notificacion.create).not.toHaveBeenCalled();
    expect(enviarPushMock).not.toHaveBeenCalled();
  });

  it('perder la carrera por la clave única no es un error', async () => {
    mockPrisma.notificacion.create.mockRejectedValue({ code: 'P2002' });

    const creada = await service.crearYEnviar({ ...base, claveIdempotencia: 'k' });

    expect(creada).toBe(false);
  });

  it('un usuario que apagó la categoría no recibe push', async () => {
    mockPrisma.preferenciaNotificacion.findMany.mockResolvedValue([
      { usuarioId: YO, jornada: false },
    ]);

    await service.crearYEnviar(base);

    expect(enviarPushMock).not.toHaveBeenCalled();
    // Pero la fila sí se creó: la bandeja la conserva.
    expect(mockPrisma.notificacion.create).toHaveBeenCalled();
  });

  it('sin fila de preferencias se asume que la categoría está encendida', async () => {
    mockPrisma.preferenciaNotificacion.findMany.mockResolvedValue([]);

    await service.crearYEnviar(base);

    expect(enviarPushMock).toHaveBeenCalled();
  });

  it('desactiva los tokens que Expo declara no registrados', async () => {
    enviarPushMock.mockResolvedValue([
      { token: 'ExponentPushToken[abc]', ok: false, error: 'muerto', dispositivoNoRegistrado: true },
    ]);

    await service.crearYEnviar(base);

    expect(mockPrisma.dispositivoPush.updateMany).toHaveBeenCalledWith({
      where: { token: { in: ['ExponentPushToken[abc]'] } },
      data: { activo: false },
    });
  });

  it('un fallo de red NO desactiva el token: puede seguir siendo válido', async () => {
    enviarPushMock.mockResolvedValue([
      { token: 'ExponentPushToken[abc]', ok: false, error: 'timeout', dispositivoNoRegistrado: false },
    ]);

    await service.crearYEnviar(base);

    expect(mockPrisma.dispositivoPush.updateMany).not.toHaveBeenCalled();
  });

  it('usa el canal de Android que corresponde a la categoría', async () => {
    await service.crearYEnviar({ ...base, categoria: 'SUSCRIPCION' });

    const mensajes = enviarPushMock.mock.calls[0][0];
    expect(mensajes[0].channelId).toBe('suscripcion');
  });

  it('una notificación de organización se expande a todos sus usuarios', async () => {
    mockPrisma.usuario.findMany.mockResolvedValue([{ id: YO }, { id: OTRO }]);
    mockPrisma.dispositivoPush.findMany.mockResolvedValue([
      { token: 'ExponentPushToken[a]' },
      { token: 'ExponentPushToken[b]' },
    ]);
    enviarPushMock.mockResolvedValue([
      { token: 'ExponentPushToken[a]', ok: true },
      { token: 'ExponentPushToken[b]', ok: true },
    ]);

    await service.crearYEnviar({ ...base, usuarioId: null });

    expect(mockPrisma.dispositivoPush.findMany.mock.calls[0][0].where.usuarioId.in).toEqual([YO, OTRO]);
  });

  it('si el push falla entero, la notificación queda creada con el error registrado', async () => {
    enviarPushMock.mockResolvedValue([
      { token: 'ExponentPushToken[abc]', ok: false, error: 'se cayó', dispositivoNoRegistrado: false },
    ]);

    await service.crearYEnviar(base);

    const update = mockPrisma.notificacion.update.mock.calls.at(-1)?.[0];
    expect(update.data.enviadaEn).toBeNull();
    expect(update.data.errorEnvio).toContain('se cayó');
  });
});
