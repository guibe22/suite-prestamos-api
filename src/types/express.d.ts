export interface UserPayload {
  id: string;
  email: string;
  rol: string;
  organizacionId?: string;
  cuentaId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}
