/**
 * Estado de la ubicación en el teléfono del cobrador, tal como lo detecta la
 * app (`suite-prestamos-app/src/services/ubicacion-estado.ts`):
 * - OK: permiso concedido, GPS encendido, ubicación precisa y real.
 * - SIN_RESPUESTA: nunca respondió el diálogo de permiso.
 * - PERMISO_DENEGADO: lo rechazó, pero la app aún puede volver a pedirlo.
 * - PERMISO_BLOQUEADO: lo rechazó con "no volver a preguntar"; solo se arregla desde Ajustes.
 * - PERMISO_REVOCADO: lo tenía concedido y lo quitó después (acción deliberada).
 * - GPS_APAGADO: apagó la ubicación del teléfono.
 * - UBICACION_APROXIMADA: concedió solo ubicación aproximada (Android 12+ / iOS 14+).
 * - UBICACION_FALSA: el sistema marca la posición como simulada (app de GPS falso, solo Android).
 */
export const ESTADOS_UBICACION = [
  'OK',
  'SIN_RESPUESTA',
  'PERMISO_DENEGADO',
  'PERMISO_BLOQUEADO',
  'PERMISO_REVOCADO',
  'GPS_APAGADO',
  'UBICACION_APROXIMADA',
  'UBICACION_FALSA',
] as const;

export type EstadoUbicacion = (typeof ESTADOS_UBICACION)[number];

export interface TelemetriaPingInput {
  /** Opcionales: un ping de estado (GPS apagado, permiso quitado) llega sin coordenadas. */
  latitud?: number;
  longitud?: number;
  rumbo?: number;
  velocidadKmH?: number;
  bateria?: number;
  estado?: 'EN_RUTA' | 'EN_COBRO' | 'PAUSADO' | 'FINALIZADO';
  rutaId?: string;
  rutaNombre?: string;
  estadoUbicacion?: EstadoUbicacion;
  /**
   * Epoch ms en que el teléfono detectó el estado. Puede ser anterior al ping:
   * si apagó el GPS sin señal, el aviso llega cuando vuelve la cobertura.
   */
  estadoUbicacionDesde?: number;
}

export interface TelemetriaCobradorRecord {
  usuarioId: string;
  organizacionId: string;
  nombre: string;
  telefono?: string;
  avatar?: string;
  /** Última posición conocida; `null` si nunca llegó una. */
  latitud: number | null;
  longitud: number | null;
  rumbo: number;
  velocidadKmH: number;
  /** 0–100, o `null` si el dispositivo no lo reportó. */
  bateria: number | null;
  estado: string;
  rutaId: string;
  rutaNombre: string;
  actualizadoEn: number;
  /** `null` = app antigua que todavía no reporta el estado de la ubicación. */
  estadoUbicacion: EstadoUbicacion | null;
  estadoUbicacionDesde: number | null;
  /** Epoch ms de la última posición recibida (≠ último ping si llegan pings sin coordenadas). */
  posicionEn: number | null;
}

/** Un cambio de estado de la ubicación de un cobrador. */
export interface EventoUbicacion {
  usuarioId: string;
  nombre: string;
  estado: EstadoUbicacion;
  /** Cuándo lo detectó el teléfono. */
  desde: number;
  /** Cuándo pasó a otro estado; `null` si sigue así. */
  hasta: number | null;
}
