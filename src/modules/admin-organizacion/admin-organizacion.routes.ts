import { Router } from 'express';
import { AdminOrganizacionController } from './admin-organizacion.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  actualizarSuscripcionOrgSchema,
  idParamSchema,
  jornadaParamsSchema,
  prestamoParamsSchema,
  listarOrganizacionesQuerySchema,
} from './admin-organizacion.schema.js';

const router = Router();
const controller = new AdminOrganizacionController();

// Panel de PLATAFORMA: solo SUPER_ADMIN, igual que /admin/planes.
router.use(authMiddleware, checkRole(['SUPER_ADMIN']));

/**
 * @swagger
 * /admin/organizaciones:
 *   get:
 *     summary: Catálogo paginado de organizaciones con su suscripción y uso — solo SUPER_ADMIN
 *     tags: [AdminOrganizacion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista paginada de organizaciones
 */
router.get('/', validate({ query: listarOrganizacionesQuerySchema }), controller.listar);

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

/**
 * @swagger
 * /admin/organizaciones/{id}/auditoria:
 *   get:
 *     summary: Bitácora de auditoría de una organización — solo SUPER_ADMIN
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
 *         description: Últimos 100 registros de auditoría
 */
router.get('/:id/auditoria', validate({ params: idParamSchema }), controller.listarAuditoria);

router.get('/:id/registros', validate({ params: idParamSchema }), controller.buscarRegistros);

/**
 * @swagger
 * /admin/organizaciones/{id}/jornadas/{jornadaId}:
 *   get:
 *     summary: Detalle de cuadre de una jornada (pagos, gastos y desembolsos) — solo SUPER_ADMIN
 *     tags: [AdminOrganizacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: jornadaId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detalle completo de la jornada
 *       404:
 *         description: La jornada no existe en esta organización
 */
router.get(
  '/:id/jornadas/:jornadaId',
  validate({ params: jornadaParamsSchema }),
  controller.obtenerDetalleJornada
);
router.delete('/:id/registros', validate({ params: idParamSchema }), controller.eliminarRegistro);
router.get('/:id/exportar', validate({ params: idParamSchema }), controller.exportarDatos);
router.post('/:id/importar', validate({ params: idParamSchema }), controller.importarDatos);
router.get('/:id/rutas', validate({ params: idParamSchema }), controller.listarRutas);

/**
 * @swagger
 * /admin/organizaciones/{id}/prestamos/{prestamoId}/incluir-en-jornada:
 *   patch:
 *     summary: Marca un préstamo excluido para que se incluya en el cuadre de su jornada — solo SUPER_ADMIN
 *     tags: [AdminOrganizacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: prestamoId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Préstamo actualizado — ahora se incluye en la jornada
 *       404:
 *         description: El préstamo no existe en esta organización
 */
router.patch(
  '/:id/prestamos/:prestamoId/incluir-en-jornada',
  validate({ params: prestamoParamsSchema }),
  controller.incluirPrestamoEnJornada
);

export default router;
