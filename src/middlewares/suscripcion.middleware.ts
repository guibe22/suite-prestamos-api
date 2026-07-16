import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { SuscripcionService } from '../modules/suscripcion/suscripcion.service.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors/custom.error.js';

const suscripcionService = new SuscripcionService();

/**
 * Bloquea escrituras que hacen crecer el uso (sync push, invitar miembro del
 * equipo) cuando la suscripción de la organización no está en TRIAL vigente
 * ni ACTIVA. Se ejecuta después de authMiddleware y antes de checkRole.
 *
 * Detrás de SUBSCRIPTIONS_ENFORCEMENT_ENABLED=false (default) deja pasar todo
 * sin consultar la base — así se puede mergear y desplegar sin afectar a
 * nadie hasta activarlo por ambiente.
 */
export const requireActiveSubscription = () => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!env.SUBSCRIPTIONS_ENFORCEMENT_ENABLED) {
      next();
      return;
    }

    if (!req.user) {
      throw new UnauthorizedError('Usuario no autenticado.');
    }

    const organizacionId = req.user.organizacionId;
    if (!organizacionId) {
      next();
      return;
    }

    try {
      const activa = await suscripcionService.tieneAccesoActivo(organizacionId);
      if (!activa) {
        throw new ForbiddenError(
          'Tu suscripción no está activa. Ve a Ajustes > Plan y facturación para reactivarla.'
        );
      }
      next();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        next(error);
        return;
      }
      logger.error({ err: error, organizacionId }, 'Error verificando estado de suscripción');
      next(error);
    }
  };
};
