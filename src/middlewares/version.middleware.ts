import type { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { ConfiguracionService } from '../modules/configuracion/configuracion.service.js';
import { ForbiddenError } from '../shared/errors/custom.error.js';

const configuracionService = new ConfiguracionService();

/** Compara "X.Y.Z" — negativo si `actual` es menor que `minima`. Misma lógica que useVersionCheck (app). */
function compararVersiones(actual: string, minima: string): number {
  const a = actual.split('.').map(Number);
  const b = minima.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Gate específico para POST /sincronizacion/push: el chequeo de versión mínima
 * ya existe del lado de la app (useVersionCheck, bloquea toda la UI antes del
 * login), pero eso confía en que el cliente se comporte — un APK modificado o
 * uno que nunca llegó a actualizarse podría seguir empujando cambios al
 * servidor. Este middleware es el respaldo: si el header `X-App-Version` no
 * cumple la versión mínima configurada, el push se rechaza aunque el cliente
 * intente saltarse su propio chequeo.
 *
 * Al igual que requireActiveSubscriptionForSync(), el pull NUNCA se bloquea
 * por esto — un dispositivo desactualizado debe poder seguir viendo (y
 * eventualmente actualizándose para volver a escribir) sus propios datos.
 *
 * IMPORTANTE al operar esto desde el panel admin (Ajustes > minVersionApp):
 * ningún build de la app anterior a la que agrega el header `X-App-Version`
 * puede enviarlo. Si se sube `minVersionApp` antes de que esa build esté
 * adoptada, TODO dispositivo sin el header quedará bloqueado de inmediato
 * (se trata como versión desconocida = desactualizada). Súbela solo después
 * de confirmar que la base de usuarios ya tiene una versión que manda el header.
 */
export const requireMinAppVersion = () => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const { minVersionApp } = await configuracionService.obtenerPublica();
      if (!minVersionApp) {
        next();
        return;
      }

      const versionRecibida = req.headers['x-app-version'];
      const versionActual = Array.isArray(versionRecibida) ? versionRecibida[0] : versionRecibida;

      if (!versionActual || compararVersiones(versionActual, minVersionApp) < 0) {
        throw new ForbiddenError(
          `Tu versión de la app (${versionActual || 'desconocida'}) está desactualizada. Se requiere la versión ${minVersionApp} o superior para sincronizar cambios — actualiza la app para poder seguir cobrando.`
        );
      }

      next();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        next(error);
        return;
      }
      logger.error({ err: error }, 'Error verificando versión mínima de la app (sync)');
      next(error);
    }
  };
};
