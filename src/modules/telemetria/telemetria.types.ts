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
  bateria: number;
  estado: string;
  rutaId: string;
  rutaNombre: string;
  actualizadoEn: number;
}
