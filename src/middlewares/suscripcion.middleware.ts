import type { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { SuscripcionService } from '../modules/suscripcion/suscripcion.service.js';
import { ConfiguracionService } from '../modules/configuracion/configuracion.service.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors/custom.error.js';

const suscripcionService = new SuscripcionService();
const configuracionService = new ConfiguracionService();

/**
 * Bloquea escrituras que hacen crecer el uso (sync push, invitar miembro del
 * equipo) cuando la suscripción de la organización no está en TRIAL vigente
 * ni ACTIVA. Se ejecuta después de authMiddleware y antes de checkRole.
 *
 * El enforcement en sí es un toggle en ConfiguracionSistema (editable desde
 * el panel admin, SUPER_ADMIN > Ajustes) — en false (default) deja pasar todo
 * sin bloquear a nadie hasta que se active explícitamente.
 */
export const requireActiveSubscription = () => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const enforcementActivo = await configuracionService.suscripcionesEnforcementEnabled();
    if (!enforcementActivo) {
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
