import { Router } from 'express';
import { SincronizacionController } from './sincronizacion.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = Router();
const controller = new SincronizacionController();

// Ruta para obtener cambios desde el servidor (Pull)
router.get('/pull', authMiddleware, controller.pull);

// Ruta para enviar cambios desde el cliente (Push)
router.post('/push', authMiddleware, controller.push);

export default router;
