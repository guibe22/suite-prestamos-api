import { Router } from 'express';
import { TelemetriaController } from './telemetria.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = Router();
const controller = new TelemetriaController();

router.use(authMiddleware);

// Reporte de ping desde la app móvil del cobrador
router.post('/ping', controller.ping);

// Consulta de cobradores activos para el radar satelital web
router.get('/activos', controller.listarActivos);

export default router;
