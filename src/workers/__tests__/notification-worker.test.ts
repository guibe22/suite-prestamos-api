import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El worker sondea en vez de engancharse a las rutas de negocio, así que lo
 * importante a probar es: (1) la ventana que mira hacia atrás, (2) a quién le
 * llega cada aviso, y (3) que las claves de idempotencia distingan los hechos
 * que de verdad son distintos.
 */

const mockPrisma = {
  usuario: { findMany: vi.fn() },
  ruta: { findFirst: vi.fn() },
  jornadaCobranza: { findMany: vi.fn() },
  suscripcion: { findMany: vi.fn() },
  organizacion: { findMany: vi.fn() },
  pago: { findMany: vi.fn() },
};

/** Forma mínima del input de crearYEnviar, para no recurrir a `any`. */
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

vi.mock('../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../modules/notificacion/notificacion.service.js', () => ({
  NotificacionService: class {
    crearYEnviar = crearYEnviar;
  },
}));

const { despacharEventos, despacharResumenDiario } = await import('../notification.worker.js');

const ORG = 'org-1';
const ADMIN = 'admin-1';
const COBRADOR = 'cobrador-1';
const AHORA = new Date('2026-10-05T12:00:00.000Z');

/** Último input con el que se llamó a crearYEnviar que cumple el predicado. */
const avisos = (
  predicado: (i: EntradaNotificacion) => boolean = () => true
): EntradaNotificacion[] => crearYEnviar.mock.calls.map((c) => c[0]).filter(predicado);

beforeEach(() => {
  vi.clearAllMocks();
  crearYEnviar.mockResolvedValue(true);
  mockPrisma.usuario.findMany.mockResolvedValue([{ id: ADMIN }]);
  mockPrisma.ruta.findFirst.mockResolvedValue({ responsableId: COBRADOR, colaboradores: [] });
  mockPrisma.jornadaCobranza.findMany.mockResolvedValue([]);
  mockPrisma.suscripcion.findMany.mockResolvedValue([]);
  mockPrisma.organizacion.findMany.mockResolvedValue([]);
  mockPrisma.pago.findMany.mockResolvedValue([]);
});

describe('ventana de sondeo', () => {
  it('mira 45 minutos hacia atrás, mucho más que el intervalo del cron', async () => {
    await despacharEventos(AHORA);

    const desde = mockPrisma.jornadaCobranza.findMany.mock.calls[0][0].where.updatedAt.gte;
    expect(AHORA.getTime() - desde.getTime()).toBe(45 * 60_000);
  });

  it('un disparador que falla no impide que corran los demás', async () => {
    mockPrisma.jornadaCobranza.findMany.mockRejectedValue(new Error('base caída'));

    await expect(despacharEventos(AHORA)).resolves.toBeUndefined();
    expect(mockPrisma.suscripcion.findMany).toHaveBeenCalled();
    expect(mockPrisma.usuario.findMany).toHaveBeenCalled();
  });
});

describe('jornadas cerradas', () => {
  const jornada = {
    id: 'j-1',
    organizacionId: ORG,
    rutaId: 'ruta-1',
    usuarioId: COBRADOR,
    efectivoCobrado: 15000,
    clientesVisitados: 12,
    ruta: { nombre: 'Centro' },
    usuario: { nombre: 'Luis' },
  };

  it('avisa al admin pero NO al cobrador que la cerró', async () => {
    mockPrisma.jornadaCobranza.findMany.mockResolvedValue([jornada]);

    await despacharEventos(AHORA);

    const destinatarios = avisos((i) => i.categoria === 'JORNADA').map((i) => i.usuarioId);
    expect(destinatarios).toContain(ADMIN);
    expect(destinatarios).not.toContain(COBRADOR);
  });

  it('el cuerpo nombra al cobrador, la ruta y el monto', async () => {
    mockPrisma.jornadaCobranza.findMany.mockResolvedValue([jornada]);

    await despacharEventos(AHORA);

    const [aviso] = avisos((i) => i.categoria === 'JORNADA');
    expect(aviso.cuerpo).toContain('Luis');
    expect(aviso.cuerpo).toContain('Centro');
    expect(aviso.cuerpo).toContain('12');
  });

  it('la clave de idempotencia distingue jornada y destinatario', async () => {
    mockPrisma.usuario.findMany.mockResolvedValue([{ id: ADMIN }, { id: 'admin-2' }]);
    mockPrisma.jornadaCobranza.findMany.mockResolvedValue([jornada]);

    await despacharEventos(AHORA);

    const claves = avisos((i) => i.categoria === 'JORNADA').map((i) => i.claveIdempotencia);
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves).toContain(`jornada-cerrada:j-1:${ADMIN}`);
  });

  it('solo mira jornadas CERRADAS y no borradas', async () => {
    await despacharEventos(AHORA);

    const where = mockPrisma.jornadaCobranza.findMany.mock.calls[0][0].where;
    expect(where.estado).toBe('CERRADA');
    expect(where.deletedAt).toBeNull();
  });
});

describe('suscripciones suspendidas', () => {
  it('el periodo entra en la clave: una suspensión posterior vuelve a avisar', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([
      { id: 'sub-1', organizacionId: ORG, periodoFinEn: new Date('2026-09-30T00:00:00.000Z') },
    ]);

    await despacharEventos(AHORA);

    const [aviso] = avisos((i) => i.categoria === 'SUSCRIPCION');
    expect(aviso.claveIdempotencia).toBe(
      `suscripcion-suspendida:sub-1:2026-09-30T00:00:00.000Z:${ADMIN}`
    );
  });

  it('aguanta una suscripción sin periodoFinEn', async () => {
    mockPrisma.suscripcion.findMany.mockResolvedValue([
      { id: 'sub-1', organizacionId: ORG, periodoFinEn: null },
    ]);

    await despacharEventos(AHORA);

    const [aviso] = avisos((i) => i.categoria === 'SUSCRIPCION');
    expect(aviso.claveIdempotencia).toContain('sin-periodo');
  });
});

describe('invitaciones aceptadas', () => {
  it('avisa a los admin del nuevo miembro', async () => {
    mockPrisma.usuario.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.invitacionAceptadaEn) {
        return [{ id: 'nuevo-1', nombre: 'Ana', organizacionId: ORG, rol: { nombre: 'COBRADOR' } }];
      }
      return [{ id: ADMIN }];
    });

    await despacharEventos(AHORA);

    const [aviso] = avisos((i) => i.categoria === 'EQUIPO');
    expect(aviso.usuarioId).toBe(ADMIN);
    expect(aviso.cuerpo).toContain('Ana');
    expect(aviso.cuerpo).toContain('COBRADOR');
  });
});

describe('resumen diario', () => {
  beforeEach(() => {
    mockPrisma.organizacion.findMany.mockResolvedValue([{ id: ORG }]);
  });

  it('no manda nada si ayer no hubo cobros', async () => {
    mockPrisma.pago.findMany.mockResolvedValue([]);

    await despacharResumenDiario(AHORA);

    expect(crearYEnviar).not.toHaveBeenCalled();
  });

  it('cuenta clientes distintos, no pagos', async () => {
    mockPrisma.pago.findMany.mockResolvedValue([
      { monto: 1000, prestamo: { clienteId: 'c1' } },
      { monto: 500, prestamo: { clienteId: 'c1' } },
      { monto: 2000, prestamo: { clienteId: 'c2' } },
    ]);

    await despacharResumenDiario(AHORA);

    const [aviso] = avisos();
    expect(aviso.cuerpo).toContain('2 clientes');
    expect(aviso.cuerpo).toContain('3 pagos');
    expect(aviso.cuerpo).toContain('3,500.00');
  });

  it('la clave de idempotencia lleva el día, para que mañana vuelva a avisar', async () => {
    mockPrisma.pago.findMany.mockResolvedValue([{ monto: 100, prestamo: { clienteId: 'c1' } }]);

    await despacharResumenDiario(AHORA);

    const [aviso] = avisos();
    expect(aviso.claveIdempotencia).toBe(`resumen-diario:${ORG}:2026-10-04:${ADMIN}`);
  });

  it('solo toma los pagos vigentes del día anterior', async () => {
    mockPrisma.pago.findMany.mockResolvedValue([{ monto: 100, prestamo: { clienteId: 'c1' } }]);

    await despacharResumenDiario(AHORA);

    const where = mockPrisma.pago.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.fechaPago.lt.getTime() - where.fechaPago.gte.getTime()).toBe(86_400_000);
    expect(where.prestamo.cliente.organizacionId).toBe(ORG);
  });

  it('un fallo en una organización no corta el resumen de las demás', async () => {
    mockPrisma.organizacion.findMany.mockResolvedValue([{ id: 'org-a' }, { id: 'org-b' }]);
    mockPrisma.pago.findMany
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([{ monto: 100, prestamo: { clienteId: 'c1' } }]);

    await despacharResumenDiario(AHORA);

    expect(avisos()).toHaveLength(1);
  });
});
