import { Router } from 'express';
import { AdminNotificacionController } from './admin-notificacion.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { diagnosticoQuerySchema, enviarAnuncioSchema } from './admin-notificacion.schema.js';

const router = Router();
const controller = new AdminNotificacionController();

// Panel de PLATAFORMA: solo SUPER_ADMIN, igual que /admin/planes y /admin/organizaciones.
router.use(authMiddleware, checkRole(['SUPER_ADMIN']));

/**
 * @swagger
 * /admin/notificaciones:
 *   post:
 *     summary: Enviar un anuncio a una organización o a todas — solo SUPER_ADMIN
 *     tags: [AdminNotificacion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Anuncio enviado
 */
router.post('/', validate({ body: enviarAnuncioSchema }), controller.enviarAnuncio);

/**
 * @swagger
 * /admin/notificaciones/diagnostico:
 *   get:
 *     summary: Estado de entregas, dispositivos y últimos fallos — solo SUPER_ADMIN
 *     tags: [AdminNotificacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dias
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Diagnóstico de notificaciones
 */
router.get('/diagnostico', validate({ query: diagnosticoQuerySchema }), controller.diagnostico);

export default router;
