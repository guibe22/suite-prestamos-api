import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import router from './routes/index.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { logger } from './config/logger.js';
import { env } from './config/env.js';

const app = express();
const isProduction = env.NODE_ENV === 'production';

// Cabeceras de seguridad HTTP (X-Content-Type-Options, HSTS, etc.)
app.use(helmet());

// CORS: en producción se restringe a una lista blanca (CORS_ORIGINS). En
// desarrollo se permite cualquier origen para facilitar pruebas locales.
const corsOrigins = env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: isProduction ? (corsOrigins && corsOrigins.length > 0 ? corsOrigins : false) : true,
  })
);

// Límite amplio para admitir imágenes en base64 (p. ej. el logo de la empresa
// dentro de configuracion.logo). El default de express es 100kb.
app.use(express.json({ limit: '5mb' }));

// Logger de peticiones básico
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Petición recibida');
  next();
});

// Rate limiting general de la API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting agresivo para autenticación (login, códigos, registro):
// mitiga fuerza bruta de contraseñas/códigos y email bombing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos. Inténtalo de nuevo más tarde.' },
});

// Documentación de API (Swagger): solo fuera de producción para no exponer
// el mapa completo de la API públicamente.
if (!isProduction) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Rutas de la API. El limiter general se aplica primero y el de auth (más
// estricto) después, para que sus cabeceras RateLimit sean las que se reflejen
// en las rutas de autenticación.
app.use('/api/v1', apiLimiter);
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1', router);

// Endpoint de salud
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Manejo de errores
app.use(errorMiddleware);

export default app;
