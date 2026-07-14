import type { z } from 'zod';
import type { crearUsuarioSchema, actualizarUsuarioSchema, idParamSchema } from './usuario.schema.js';

export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;
export type ActualizarUsuarioInput = z.infer<typeof actualizarUsuarioSchema>;
export type IdParamInput = z.infer<typeof idParamSchema>;

export interface MiembroEquipoResponse {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  createdAt: Date;
}

export interface MiembroEquipoCreadoResponse extends MiembroEquipoResponse {
  passwordTemporal?: string;
}
