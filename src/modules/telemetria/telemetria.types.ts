export interface TelemetriaPingInput {
  latitud: number;
  longitud: number;
  rumbo?: number;
  velocidadKmH?: number;
  bateria?: number;
  estado?: 'EN_RUTA' | 'EN_COBRO' | 'PAUSADO' | 'FINALIZADO';
  rutaId?: string;
  rutaNombre?: string;
}

export interface TelemetriaCobradorRecord {
  usuarioId: string;
  organizacionId: string;
  nombre: string;
  telefono?: string;
  avatar?: string;
  latitud: number;
  longitud: number;
  rumbo: number;
  velocidadKmH: number;
  /** 0–100, o `null` si el dispositivo no lo reportó. */
  bateria: number | null;
  estado: string;
  rutaId: string;
  rutaNombre: string;
  actualizadoEn: number;
}
