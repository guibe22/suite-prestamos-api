import { Router } from 'express';
import { AdminPlanController } from './admin-plan.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { crearPlanSchema, actualizarPlanSchema, idParamSchema } from './admin-plan.schema.js';

const router = Router();
const controller = new AdminPlanController();

// Panel de PLATAFORMA: a diferencia del resto de la API, aquí SUPER_ADMIN es
// deliberadamente el único rol permitido (sin 'ADMIN') — un admin de una
// organización cliente no debe poder ver ni tocar el catálogo global de planes.
router.use(authMiddleware, checkRole(['SUPER_ADMIN']));

/**
 * @swagger
 * /admin/planes:
 *   get:
 *     summary: Catálogo completo de planes (activos e inactivos) — solo SUPER_ADMIN
 *     tags: [AdminPlan]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de planes
 */
router.get('/', controller.listar);

/**
 * @swagger
 * /admin/planes:
 *   post:
 *     summary: Crea un nuevo plan — solo SUPER_ADMIN
 *     tags: [AdminPlan]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Plan creado
 */
router.post('/', validate({ body: crearPlanSchema }), controller.crear);

/**
 * @swagger
 * /admin/planes/{id}:
 *   patch:
 *     summary: Edita un plan existente — solo SUPER_ADMIN
 *     tags: [AdminPlan]
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
 *         description: Plan actualizado
 */
router.patch('/:id', validate({ params: idParamSchema, body: actualizarPlanSchema }), controller.actualizar);

/**
 * @swagger
 * /admin/planes/{id}/generar-paypal:
 *   post:
 *     summary: Crea el producto y billing plan en PayPal para este plan y guarda el paypalPlanId — solo SUPER_ADMIN
 *     tags: [AdminPlan]
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
 *         description: Plan vinculado a PayPal
 */
router.post('/:id/generar-paypal', validate({ params: idParamSchema }), controller.generarEnPaypal);

export default router;
