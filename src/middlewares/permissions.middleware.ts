import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../shared/errors/custom.error.js';

export const checkRole = (allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Usuario no autenticado.');
    }

    const hasRole = allowedRoles.includes(req.user.rol);
    if (!hasRole) {
      throw new ForbiddenError('No tienes permisos suficientes para realizar esta acción.');
    }

    next();
  };
};
