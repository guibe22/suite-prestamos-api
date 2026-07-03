import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import router from './routes/index.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { logger } from './config/logger.js';

const app = express();

// Middlewares globales
app.use(cors());
// Límite amplio para admitir imágenes en base64 (p. ej. el logo de la empresa
// dentro de configuracion.logo). El default de express es 100kb.
app.use(express.json({ limit: '5mb' }));

// Logger de peticiones básico
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Petición recibida');
  next();
});

// Documentación de API (Swagger)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Rutas de la API
app.use('/api/v1', router);

// Endpoint de salud
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Manejo de errores
app.use(errorMiddleware);

export default app;
