import { logger } from '../../config/logger.js';
import { prisma } from '../../config/database.js';
import type { TelemetriaPingInput, TelemetriaCobradorRecord } from './telemetria.types.js';

export class TelemetriaService {
  // Store en memoria de alta velocidad: cero llamadas a disco por ping, latencia <1ms
  private static store = new Map<string, TelemetriaCobradorRecord>();

  /**
   * Registra el ping periódico del cobrador en ruta
   */
  async reportarPing(
    usuarioId: string,
    organizacionId: string,
    input: TelemetriaPingInput
  ): Promise<TelemetriaCobradorRecord> {
    // Si no tenemos el nombre en caché, consultamos el usuario una sola vez
    let record = TelemetriaService.store.get(usuarioId);
    let nombre = record?.nombre;
    let telefono = record?.telefono;

    if (!nombre) {
      const u = await prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { nombre: true, email: true },
      });
      nombre = u?.nombre || 'Cobrador';
    }

    const nuevoRecord: TelemetriaCobradorRecord = {
      usuarioId,
      organizacionId,
      nombre,
      telefono: telefono || '',
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=059669&color=fff`,
      latitud: Number(input.latitud),
      longitud: Number(input.longitud),
      rumbo: Number(input.rumbo || 0),
      velocidadKmH: Math.max(0, Math.round(Number(input.velocidadKmH || 0))),
      bateria: Math.min(100, Math.max(0, Math.round(Number(input.bateria ?? 100)))),
      estado: input.estado || 'EN_RUTA',
      rutaId: input.rutaId || record?.rutaId || '',
      rutaNombre: input.rutaNombre || record?.rutaNombre || 'Ruta en Curso',
      actualizadoEn: Date.now(),
    };

    TelemetriaService.store.set(usuarioId, nuevoRecord);
    return nuevoRecord;
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
