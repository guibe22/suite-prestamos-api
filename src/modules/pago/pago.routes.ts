import { Router } from 'express';
import { PagoController } from './pago.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { idParamSchema } from './pago.schema.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';

const router = Router();
const controller = new PagoController();

/**
 * @swagger
 * /pago/{id}:
 *   delete:
 *     summary: Eliminar un pago (recalcula cuotas y estado del préstamo afectado)
 *     tags: [Pago]
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
 *         description: Pago eliminado con éxito
 */
router.delete(
  '/:id',
  authMiddleware,
  checkRole(['ADMIN', 'SUPER_ADMIN']),
  validate({ params: idParamSchema }),
  controller.eliminar
);

export default router;
