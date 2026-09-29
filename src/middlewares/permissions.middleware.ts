import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../shared/errors/custom.error.js';
import { resolverPermisosUsuario } from '../shared/constants/permissions.constants.js';

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

export const checkPermission = (requiredPermission: string) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Usuario no autenticado.');
    }

    if (req.user.rol === 'ADMIN' || req.user.rol === 'SUPER_ADMIN') {
      return next();
    }

    const permisos = resolverPermisosUsuario(req.user.rol, req.user.permisos);
    if (!permisos.includes(requiredPermission)) {
      throw new ForbiddenError('No tienes permisos suficientes para realizar esta acción.');
    }

    next();
  };
};

export const checkAnyPermission = (requiredPermissions: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Usuario no autenticado.');
    }

    if (req.user.rol === 'ADMIN' || req.user.rol === 'SUPER_ADMIN') {
      return next();
    }

    const permisos = resolverPermisosUsuario(req.user.rol, req.user.permisos);
    const hasAny = requiredPermissions.some((perm) => permisos.includes(perm));
    if (!hasAny) {
      throw new ForbiddenError('No tienes permisos suficientes para realizar esta acción.');
    }

    next();
  };
};

