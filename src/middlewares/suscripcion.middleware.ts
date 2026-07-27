import type { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { SuscripcionService, formatearContacto } from '../modules/suscripcion/suscripcion.service.js';
import { ConfiguracionService } from '../modules/configuracion/configuracion.service.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors/custom.error.js';

const suscripcionService = new SuscripcionService();
const configuracionService = new ConfiguracionService();

async function resolverOrganizacionId(req: Request): Promise<string | null> {
  if (!req.user) {
    throw new UnauthorizedError('Usuario no autenticado.');
  }
  return req.user.organizacionId ?? null;
}

/**
 * Bloquea acciones que hacen CRECER el uso (invitar miembro del equipo) en
 * cuanto la suscripción deja de estar ACTIVA/TRIAL vigente — a diferencia del
 * sync push, esto NO tiene excepción durante el periodo de gracia: agregar
 * gente al equipo no es "seguir cobrando", así que se corta desde el día 1.
 * Se ejecuta después de authMiddleware y antes de checkRole.
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

    const organizacionId = await resolverOrganizacionId(req);
    if (!organizacionId) {
      next();
      return;
    }

    try {
      const acceso = await suscripcionService.obtenerNivelAcceso(organizacionId);
      if (acceso.nivel !== 'ACTIVO') {
        const contacto = formatearContacto(acceso.soporteTelefono, acceso.soporteEmail);
        throw new ForbiddenError(
          `Tu suscripción no está activa. Ve a Ajustes > Plan y facturación para reactivarla. ${contacto}`.trim()
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

/** Tablas de WatermelonDB que hacen crecer el uso — ver `SincronizacionService.push()`. */
const TABLAS_CRECIMIENTO = ['clientes', 'prestamos', 'rutas'] as const;

/**
 * Gate específico para POST /sincronizacion/push: a diferencia de
 * requireActiveSubscription(), durante el periodo de gracia (recién vencida,
 * dentro de `suscripcionGraciaDias`) SÍ deja pasar el push mientras no
 * intente crear clientes, préstamos o rutas nuevas — así una organización
 * suspendida puede seguir cobrando lo que ya prestó (y tener con qué pagar)
 * sin poder seguir creciendo. Agotada la gracia, se bloquea todo el push
 * igual que antes.
 */
export const requireActiveSubscriptionForSync = () => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const enforcementActivo = await configuracionService.suscripcionesEnforcementEnabled();
    if (!enforcementActivo) {
      next();
      return;
    }

    const organizacionId = await resolverOrganizacionId(req);
    if (!organizacionId) {
      next();
      return;
    }

    try {
      const acceso = await suscripcionService.obtenerNivelAcceso(organizacionId);
      if (acceso.nivel === 'ACTIVO') {
        next();
        return;
      }

      const contacto = formatearContacto(acceso.soporteTelefono, acceso.soporteEmail);

      if (acceso.nivel === 'BLOQUEADO') {
        throw new ForbiddenError(
          `Tu suscripción no está activa y el periodo de gracia ya terminó — no se pueden sincronizar cambios. Ve a Ajustes > Plan y facturación para reactivarla. ${contacto}`.trim()
        );
      }

      // GRACIA: solo se bloquea si el push intenta agregar algo que hace crecer el uso.
      const changes = (req.body?.changes ?? {}) as Record<string, { created?: unknown[] }>;
      const intentaCrecer = TABLAS_CRECIMIENTO.some((tabla) => (changes[tabla]?.created?.length ?? 0) > 0);

      if (intentaCrecer) {
        throw new ForbiddenError(
          `Tu suscripción venció — tienes ${acceso.diasRestantesGracia} día(s) de gracia para seguir cobrando lo que ya prestaste, pero no puedes agregar clientes, préstamos ni rutas nuevas hasta reactivar. ${contacto}`.trim()
        );
      }

      next();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        next(error);
        return;
      }
      logger.error({ err: error, organizacionId }, 'Error verificando estado de suscripción (sync)');
      next(error);
    }
  };
};
