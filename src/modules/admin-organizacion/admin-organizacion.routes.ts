import { Router } from 'express';
import { AdminOrganizacionController } from './admin-organizacion.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { actualizarSuscripcionOrgSchema, idParamSchema } from './admin-organizacion.schema.js';

const router = Router();
const controller = new AdminOrganizacionController();

// Panel de PLATAFORMA: solo SUPER_ADMIN, igual que /admin/planes.
router.use(authMiddleware, checkRole(['SUPER_ADMIN']));

/**
 * @swagger
 * /admin/organizaciones:
 *   get:
 *     summary: Catálogo de organizaciones con su suscripción y uso — solo SUPER_ADMIN
 *     tags: [AdminOrganizacion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de organizaciones
 */
router.get('/', controller.listar);

/**
 * @swagger
 * /admin/organizaciones/{id}/suscripcion:
 *   patch:
 *     summary: Alta/edición manual de la suscripción de una organización — solo SUPER_ADMIN
 *     tags: [AdminOrganizacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Suscripción actualizada
 */
router.patch(
  '/:id/suscripcion',
  validate({ params: idParamSchema, body: actualizarSuscripcionOrgSchema }),
  controller.actualizarSuscripcion
);

export default router;
