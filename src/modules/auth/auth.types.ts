import type { z } from 'zod';
import type { loginSchema, registerSchema } from './auth.schema.js';

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface OrganizacionSessionInfo {
  id: string;
  nombre: string;
  identificacionTributaria: string | null;
  direccion: string | null;
  telefono: string | null;
  configuracion: unknown;
}

export interface UserSessionResponse {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  organizacionId?: string | null;
  organizacionConfigurada: boolean;
  organizacion: OrganizacionSessionInfo | null;
  tokens: TokenResponse;
}
