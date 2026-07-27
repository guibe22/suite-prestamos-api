import * as Sentry from '@sentry/node';
import { env } from './env.js';

/**
 * Sin SENTRY_DSN, el SDK queda deshabilitado (enabled: false) — no cambia
 * ningún comportamiento hasta que se configure la variable de entorno.
 */
Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  enabled: !!env.SENTRY_DSN,
});

export { Sentry };
