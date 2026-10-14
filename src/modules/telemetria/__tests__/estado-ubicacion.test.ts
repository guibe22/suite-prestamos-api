import { describe, it, expect, vi } from 'vitest';

/*
 * Estado de la ubicación en la telemetría: el ping puede llegar sin
 * coordenadas (GPS apagado, permiso quitado) y cada cambio de estado queda
 * como evento persistido para el radar del panel.
 */
interface FilaEvento {
  id: string;
  organizacionId: string;
  usuarioId: string;
  estado: string;
  desde: Date;
  hasta: Date | null;
  createdAt: Date;
}

// Tabla EventoUbicacion en memoria, con lo justo que usa el servicio.
const filas: FilaEvento[] = [];
let secuencia = 0;

const mockPrisma = {
  usuario: { findUnique: vi.fn(async () => ({ nombre: 'Cobrador Uno', email: 'c1@x.com' })) },
  eventoUbicacion: {
    findFirst: vi.fn(async ({ where }: { where: { usuarioId: string; organizacionId: string } }) =>
      filas
        .filter((f) => f.usuarioId === where.usuarioId && f.organizacionId === where.organizacionId && f.hasta === null)
        .sort((a, b) => b.desde.getTime() - a.desde.getTime())[0] ?? null
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { hasta: Date } }) => {
      const fila = filas.find((f) => f.id === where.id)!;
      fila.hasta = data.hasta;
      return fila;
    }),
    create: vi.fn(async ({ data }: { data: Omit<FilaEvento, 'id' | 'hasta' | 'createdAt'> }) => {
      secuencia += 1;
      const fila = { ...data, id: `ev-${secuencia}`, hasta: null, createdAt: new Date(secuencia) };
      filas.push(fila);
      return fila;
    }),
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: { organizacionId: string; usuarioId?: string; OR?: [unknown, { hasta: { gte: Date } }] };
      }) => {
        const desde = where.OR?.[1].hasta.gte;
        return filas
          .filter(
            (f) =>
              f.organizacionId === where.organizacionId &&
              (!where.usuarioId || f.usuarioId === where.usuarioId) &&
              (!desde || f.hasta === null || f.hasta >= desde)
          )
          .sort((a, b) => b.desde.getTime() - a.desde.getTime() || b.createdAt.getTime() - a.createdAt.getTime())
          .map((f) => ({ ...f, usuario: { nombre: 'Cobrador Uno' } }));
      }
    ),
  },
  $transaction: vi.fn(async (operaciones: Promise<unknown>[]) => Promise.all(operaciones)),
};

vi.mock('../../../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { TelemetriaService } = await import('../telemetria.service.js');
const { logger } = await import('../../../config/logger.js');

/** Lee los eventos después de que terminen las escrituras en segundo plano. */
async function eventosDe(servicio: InstanceType<typeof TelemetriaService>, organizacionId: string, filtro = {}) {
  await TelemetriaService.esperarEscrituras();
  return servicio.obtenerEventos(organizacionId, filtro);
}

// El store es estático: cada prueba usa su propia organización y usuario.
let n = 0;
const nuevoActor = () => {
  n += 1;
  return { usuarioId: `u-${n}`, organizacionId: `org-${n}` };
};

describe('telemetría: estado de la ubicación', () => {
  it('un ping sin coordenadas conserva la última posición conocida', async () => {
    const servicio = new TelemetriaService();
    const { usuarioId, organizacionId } = nuevoActor();

    await servicio.reportarPing(usuarioId, organizacionId, { latitud: 18.5, longitud: -69.9, estadoUbicacion: 'OK' });
    const record = await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'GPS_APAGADO' });

    expect(record.latitud).toBe(18.5);
    expect(record.longitud).toBe(-69.9);
    expect(record.estadoUbicacion).toBe('GPS_APAGADO');
    expect(record.velocidadKmH).toBe(0);
  });

  it('registra un evento solo cuando el estado cambia y cierra el anterior', async () => {
    const servicio = new TelemetriaService();
    const { usuarioId, organizacionId } = nuevoActor();

    const ok = { latitud: 1, longitud: 1, estadoUbicacion: 'OK' as const, estadoUbicacionDesde: 500 };
    await servicio.reportarPing(usuarioId, organizacionId, ok);
    await servicio.reportarPing(usuarioId, organizacionId, ok);
    await servicio.reportarPing(usuarioId, organizacionId, {
      estadoUbicacion: 'PERMISO_REVOCADO',
      estadoUbicacionDesde: 1_000,
    });

    const eventos = await eventosDe(servicio, organizacionId);
    expect(eventos.map((e) => e.estado)).toEqual(['PERMISO_REVOCADO', 'OK']);
    expect(eventos[0].desde).toBe(1_000);
    expect(eventos[0].hasta).toBeNull();
    expect(eventos[1].hasta).toBe(1_000);
  });

  it('no acepta una fecha de detección en el futuro', async () => {
    const servicio = new TelemetriaService();
    const { usuarioId, organizacionId } = nuevoActor();
    const antes = Date.now();

    const record = await servicio.reportarPing(usuarioId, organizacionId, {
      estadoUbicacion: 'GPS_APAGADO',
      estadoUbicacionDesde: antes + 3_600_000,
    });

    expect(record.estadoUbicacionDesde).toBeLessThanOrEqual(Date.now());
  });

  it('ignora un estado desconocido y mantiene el último válido', async () => {
    const servicio = new TelemetriaService();
    const { usuarioId, organizacionId } = nuevoActor();

    await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'UBICACION_FALSA' });
    const record = await servicio.reportarPing(usuarioId, organizacionId, {
      latitud: 2,
      longitud: 2,
      // @ts-expect-error valor que no está en el catálogo
      estadoUbicacion: 'INVENTADO',
    });

    expect(record.estadoUbicacion).toBe('UBICACION_FALSA');
    expect(await eventosDe(servicio, organizacionId)).toHaveLength(1);
  });

  it('filtra los eventos por cobrador y no mezcla organizaciones', async () => {
    const servicio = new TelemetriaService();
    const a = nuevoActor();
    const b = nuevoActor();

    await servicio.reportarPing(a.usuarioId, a.organizacionId, { estadoUbicacion: 'GPS_APAGADO' });
    await servicio.reportarPing(b.usuarioId, b.organizacionId, { estadoUbicacion: 'PERMISO_BLOQUEADO' });

    expect(await eventosDe(servicio, a.organizacionId, { usuarioId: a.usuarioId })).toHaveLength(1);
    expect(await eventosDe(servicio, a.organizacionId, { usuarioId: b.usuarioId })).toHaveLength(0);
  });

  it('un aviso atrasado no empieza antes que el estado que cierra', async () => {
    const servicio = new TelemetriaService();
    const { usuarioId, organizacionId } = nuevoActor();

    await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'OK', estadoUbicacionDesde: 2_000 });
    await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'GPS_APAGADO', estadoUbicacionDesde: 1_000 });

    const [actual, anterior] = await eventosDe(servicio, organizacionId);
    expect(actual).toMatchObject({ estado: 'GPS_APAGADO', desde: 2_000, hasta: null });
    expect(anterior).toMatchObject({ estado: 'OK', desde: 2_000, hasta: 2_000 });
  });

  it('devuelve el evento con la forma que consume el panel', async () => {
    const servicio = new TelemetriaService();
    const { usuarioId, organizacionId } = nuevoActor();

    await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'GPS_APAGADO', estadoUbicacionDesde: 5_000 });

    expect(await eventosDe(servicio, organizacionId)).toEqual([
      { usuarioId, nombre: 'Cobrador Uno', estado: 'GPS_APAGADO', desde: 5_000, hasta: null },
    ]);
  });

  it('con `desde` excluye los eventos que ya habían terminado antes', async () => {
    const servicio = new TelemetriaService();
    const { usuarioId, organizacionId } = nuevoActor();

    await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'GPS_APAGADO', estadoUbicacionDesde: 1_000 });
    await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'OK', estadoUbicacionDesde: 2_000 });
    await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'UBICACION_FALSA', estadoUbicacionDesde: 3_000 });

    const eventos = await eventosDe(servicio, organizacionId, { desde: 2_500 });
    expect(eventos.map((e) => e.estado)).toEqual(['UBICACION_FALSA', 'OK']);
  });

  it('tras un reinicio no duplica el estado que ya estaba abierto en la BD', async () => {
    const { usuarioId, organizacionId } = nuevoActor();
    await new TelemetriaService().reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'GPS_APAGADO' });
    await TelemetriaService.esperarEscrituras();

    // Simula el reinicio: la memoria del API se pierde, la BD no.
    (TelemetriaService as unknown as { store: Map<string, unknown> }).store.delete(usuarioId);
    const servicio = new TelemetriaService();
    await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'GPS_APAGADO' });

    expect(await eventosDe(servicio, organizacionId)).toHaveLength(1);
  });

  it('si la BD falla el ping responde igual y el error queda en el log', async () => {
    const servicio = new TelemetriaService();
    const { usuarioId, organizacionId } = nuevoActor();
    mockPrisma.eventoUbicacion.findFirst.mockRejectedValueOnce(new Error('BD caída'));

    const record = await servicio.reportarPing(usuarioId, organizacionId, { estadoUbicacion: 'PERMISO_REVOCADO' });
    await TelemetriaService.esperarEscrituras();

    expect(record.estadoUbicacion).toBe('PERMISO_REVOCADO');
    expect(logger.error).toHaveBeenCalled();
  });
});
