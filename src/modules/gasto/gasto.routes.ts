import { Router } from 'express';
import { GastoController } from './gasto.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { idParamSchema } from './gasto.schema.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';

const router = Router();
const controller = new GastoController();

/**
 * @swagger
 * /gasto/{id}:
 *   delete:
 *     summary: Eliminar un gasto
 *     tags: [Gasto]
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
 *         description: Gasto eliminado con éxito
 */
router.delete(
  '/:id',
  authMiddleware,
  checkRole(['ADMIN', 'SUPER_ADMIN', 'GERENTE']),
  validate({ params: idParamSchema }),
  controller.eliminar
);

export default router;
