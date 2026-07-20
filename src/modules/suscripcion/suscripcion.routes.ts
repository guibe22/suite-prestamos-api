import { Router } from 'express';
import { SuscripcionController } from './suscripcion.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = Router();
const controller = new SuscripcionController();

/**
 * @swagger
 * /suscripcion/mi-suscripcion:
 *   get:
 *     summary: Estado de la suscripción de la organización del usuario autenticado
 *     tags: [Suscripcion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Suscripción, plan y uso actual
 */
router.get('/mi-suscripcion', authMiddleware, controller.miSuscripcion);

/**
 * @swagger
 * /suscripcion/planes:
 *   get:
 *     summary: Catálogo de planes activos disponibles para suscribirse
 *     tags: [Suscripcion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de planes activos
 */
router.get('/planes', authMiddleware, controller.planes);

/**
 * @swagger
 * /suscripcion/revenuecat/webhook:
 *   post:
 *     summary: Receptor de eventos de RevenueCat (autenticado por header Authorization, no por JWT)
 *     tags: [Suscripcion]
 *     responses:
 *       200:
 *         description: Evento procesado (o ya procesado previamente)
 */
router.post('/revenuecat/webhook', controller.revenuecatWebhook);

export default router;
