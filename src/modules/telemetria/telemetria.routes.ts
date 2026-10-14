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

// Cambios de estado de la ubicación del cobrador (GPS apagado, permiso quitado, GPS falso)
router.get('/eventos', controller.listarEventos);

export default router;
