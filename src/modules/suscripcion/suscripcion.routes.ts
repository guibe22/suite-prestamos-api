import { Router } from 'express';
import { SuscripcionController } from './suscripcion.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { iniciarPaypalSchema, verificarCompraGoogleSchema } from './suscripcion.schema.js';

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
 * /suscripcion/paypal/iniciar:
 *   post:
 *     summary: Crea una suscripción de PayPal para la organización y devuelve el link de aprobación
 *     tags: [Suscripcion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: URL de aprobación hospedada por PayPal
 */
router.post(
  '/paypal/iniciar',
  authMiddleware,
  checkRole(['ADMIN', 'SUPER_ADMIN']),
  validate({ body: iniciarPaypalSchema }),
  controller.iniciarPaypal
);

/**
 * @swagger
 * /suscripcion/paypal/webhook:
 *   post:
 *     summary: Receptor de eventos de PayPal (autenticado por firma, no por JWT)
 *     tags: [Suscripcion]
 *     responses:
 *       200:
 *         description: Evento procesado (o ya procesado previamente)
 */
router.post('/paypal/webhook', controller.paypalWebhook);

/**
 * @swagger
 * /suscripcion/google/verificar-compra:
 *   post:
 *     summary: Verifica una compra de Google Play Billing y la vincula a la organización
 *     tags: [Suscripcion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Compra verificada contra la Play Developer API
 */
router.post(
  '/google/verificar-compra',
  authMiddleware,
  checkRole(['ADMIN', 'SUPER_ADMIN']),
  validate({ body: verificarCompraGoogleSchema }),
  controller.verificarCompraGoogle
);

/**
 * @swagger
 * /suscripcion/google/rtdn:
 *   post:
 *     summary: Receptor de Real-Time Developer Notifications de Google Play (push de Pub/Sub)
 *     tags: [Suscripcion]
 *     responses:
 *       200:
 *         description: Notificación procesada (o ignorada si no se reconoce)
 */
router.post('/google/rtdn', controller.googleRtdn);

export default router;
