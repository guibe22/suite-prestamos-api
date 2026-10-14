import { logger } from '../../config/logger.js';
import { prisma } from '../../config/database.js';
import {
  ESTADOS_UBICACION,
  type EstadoUbicacion,
  type EventoUbicacion,
  type TelemetriaCobradorRecord,
  type TelemetriaPingInput,
} from './telemetria.types.js';

/**
 * Nivel de batería 0–100 o `null` si el dispositivo no lo reportó (o llegó
 * algo no numérico). No se inventa un 100: el panel muestra "No disponible".
 */
function normalizarBateria(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizarEstadoUbicacion(valor: unknown): EstadoUbicacion | null {
  return ESTADOS_UBICACION.includes(valor as EstadoUbicacion) ? (valor as EstadoUbicacion) : null;
}

function numeroFinito(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Eventos de ubicación que devuelve una consulta (los más recientes). */
const MAX_EVENTOS = 500;

export class TelemetriaService {
  // Store en memoria de alta velocidad: cero llamadas a disco por ping, latencia <1ms
  private static store = new Map<string, TelemetriaCobradorRecord>();
  /**
   * Escritura en curso de los eventos de ubicación por usuario. Encadena las
   * escrituras del mismo cobrador para que cerrar el estado anterior y abrir
   * el nuevo no se crucen si llegan dos cambios seguidos.
   */
  private static escrituras = new Map<string, Promise<void>>();

  /** Espera a que terminen las escrituras de eventos pendientes (tests, apagado ordenado). */
  static async esperarEscrituras(): Promise<void> {
    await Promise.all(TelemetriaService.escrituras.values());
  }

  /**
   * Registra el ping periódico del cobrador en ruta. Puede llegar sin
   * coordenadas cuando lo que reporta es el estado de la ubicación (GPS
   * apagado, permiso quitado): entonces se conserva la última posición.
   */
  async reportarPing(
    usuarioId: string,
    organizacionId: string,
    input: TelemetriaPingInput
  ): Promise<TelemetriaCobradorRecord> {
    // Si no tenemos el nombre en caché, consultamos el usuario una sola vez
    const record = TelemetriaService.store.get(usuarioId);
    let nombre = record?.nombre;
    const telefono = record?.telefono;

    if (!nombre) {
      const u = await prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { nombre: true, email: true },
      });
      nombre = u?.nombre || 'Cobrador';
    }

    const ahora = Date.now();
    const lat = numeroFinito(input.latitud);
    const lng = numeroFinito(input.longitud);
    const traePosicion = lat !== null && lng !== null;

    const estadoUbicacion = normalizarEstadoUbicacion(input.estadoUbicacion);
    // El teléfono manda cuándo lo detectó; nunca se acepta una fecha futura.
    const detectadoEn = Math.min(ahora, numeroFinito(input.estadoUbicacionDesde) ?? ahora);
    const cambioDeEstado =
      estadoUbicacion !== null && estadoUbicacion !== (record?.estadoUbicacion ?? null);

    const nuevoRecord: TelemetriaCobradorRecord = {
      usuarioId,
      organizacionId,
      nombre,
      telefono: telefono || '',
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=059669&color=fff`,
      latitud: traePosicion ? lat : (record?.latitud ?? null),
      longitud: traePosicion ? lng : (record?.longitud ?? null),
      rumbo: traePosicion ? Number(input.rumbo || 0) : (record?.rumbo ?? 0),
      velocidadKmH: traePosicion ? Math.max(0, Math.round(Number(input.velocidadKmH || 0))) : 0,
      bateria: normalizarBateria(input.bateria),
      estado: input.estado || 'EN_RUTA',
      rutaId: input.rutaId || record?.rutaId || '',
      rutaNombre: input.rutaNombre || record?.rutaNombre || 'Ruta en Curso',
      actualizadoEn: ahora,
      estadoUbicacion: estadoUbicacion ?? record?.estadoUbicacion ?? null,
      estadoUbicacionDesde: cambioDeEstado ? detectadoEn : (record?.estadoUbicacionDesde ?? null),
      posicionEn: traePosicion ? ahora : (record?.posicionEn ?? null),
    };

    if (cambioDeEstado && estadoUbicacion) {
      this.registrarEvento(organizacionId, {
        usuarioId,
        nombre,
        estado: estadoUbicacion,
        desde: detectadoEn,
        hasta: null,
      });
      if (estadoUbicacion !== 'OK') {
        logger.info(`📍 [TELEMETRÍA] ${nombre} (${usuarioId}) → ${estadoUbicacion}`);
      }
    }

    TelemetriaService.store.set(usuarioId, nuevoRecord);
    return nuevoRecord;
  }

  /**
   * Persiste el cambio de estado sin bloquear el ping: la escritura corre en
   * segundo plano y, si la BD falla, solo se registra en el log.
   */
  private registrarEvento(organizacionId: string, evento: EventoUbicacion): void {
    const anterior = TelemetriaService.escrituras.get(evento.usuarioId) ?? Promise.resolve();
    const escritura = anterior
      .then(() => this.persistirEvento(organizacionId, evento))
      .catch((error) => {
        logger.error(
          `📍 [TELEMETRÍA] No se pudo guardar el evento de ubicación ${evento.estado} de ${evento.usuarioId}`,
          error
        );
      })
      .finally(() => {
        if (TelemetriaService.escrituras.get(evento.usuarioId) === escritura) {
          TelemetriaService.escrituras.delete(evento.usuarioId);
        }
      });
    TelemetriaService.escrituras.set(evento.usuarioId, escritura);
  }

  /** Cierra el estado abierto del usuario y abre el nuevo. */
  private async persistirEvento(organizacionId: string, evento: EventoUbicacion): Promise<void> {
    const abierto = await prisma.eventoUbicacion.findFirst({
      where: { usuarioId: evento.usuarioId, organizacionId, hasta: null },
      orderBy: { desde: 'desc' },
      select: { id: true, estado: true, desde: true },
    });
    // Tras un reinicio del API la memoria no sabe el último estado: si el
    // abierto en BD ya es este, no se duplica.
    if (abierto?.estado === evento.estado) return;

    // Un aviso atrasado (llegó al volver la señal) no puede empezar antes que
    // el estado que cierra: el historial queda encadenado y sin hasta < desde.
    const desde = new Date(Math.max(evento.desde, abierto?.desde.getTime() ?? 0));
    await prisma.$transaction([
      ...(abierto
        ? [prisma.eventoUbicacion.update({ where: { id: abierto.id }, data: { hasta: desde } })]
        : []),
      prisma.eventoUbicacion.create({
        data: { organizacionId, usuarioId: evento.usuarioId, estado: evento.estado, desde },
      }),
    ]);
  }

  /**
   * Cambios de estado de la ubicación de la organización, del más reciente al
   * más antiguo (máx. 500). Con `usuarioId`, solo los de ese cobrador; con
   * `desde`, solo los que seguían vigentes o terminaron después de esa fecha.
   */
  async obtenerEventos(
    organizacionId: string,
    filtro: { usuarioId?: string; desde?: number } = {}
  ): Promise<EventoUbicacion[]> {
    const filas = await prisma.eventoUbicacion.findMany({
      where: {
        organizacionId,
        ...(filtro.usuarioId ? { usuarioId: filtro.usuarioId } : {}),
        ...(filtro.desde ? { OR: [{ hasta: null }, { hasta: { gte: new Date(filtro.desde) } }] } : {}),
      },
      orderBy: [{ desde: 'desc' }, { createdAt: 'desc' }],
      take: MAX_EVENTOS,
      select: {
        usuarioId: true,
        estado: true,
        desde: true,
        hasta: true,
        usuario: { select: { nombre: true } },
      },
    });

    return filas.map((f) => ({
      usuarioId: f.usuarioId,
      nombre: f.usuario?.nombre || 'Cobrador',
      estado: f.estado,
      desde: f.desde.getTime(),
      hasta: f.hasta ? f.hasta.getTime() : null,
    }));
  }

  /**
   * Obtiene todos los cobradores con actividad reciente (últimos 20 minutos)
   */
  obtenerActivos(organizacionId: string): TelemetriaCobradorRecord[] {
    const ahora = Date.now();
    const LIMITE_ACTIVO_MS = 20 * 60 * 1000; // 20 minutos
    const cobradores: TelemetriaCobradorRecord[] = [];

    for (const record of TelemetriaService.store.values()) {
      if (record.organizacionId === organizacionId && ahora - record.actualizadoEn <= LIMITE_ACTIVO_MS) {
        cobradores.push(record);
      }
    }

    return cobradores;
  }
}
