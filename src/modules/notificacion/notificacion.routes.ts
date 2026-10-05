import { Router } from 'express';
import { NotificacionController } from './notificacion.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import {
  bajaDispositivoSchema,
  idParamSchema,
  listarQuerySchema,
  preferenciasSchema,
  registrarDispositivoSchema,
} from './notificacion.schema.js';

/**
 * Ninguna ruta lleva `checkPermission`: recibir las propias notificaciones y
 * administrar el propio dispositivo no es un privilegio que se otorgue, es
 * parte de tener una cuenta. El alcance lo da el JWT, no un permiso.
 */
const router = Router();
const controller = new NotificacionController();

/**
 * @swagger
 * /notificacion/dispositivo:
 *   post:
 *     summary: Registrar el token de push de este dispositivo
 *     tags: [Notificacion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dispositivo registrado
 */
router.post(
  '/dispositivo',
  authMiddleware,
  validate({ body: registrarDispositivoSchema }),
  controller.registrarDispositivo
);

/**
 * @swagger
 * /notificacion/dispositivo:
 *   delete:
 *     summary: Dar de baja el token de push al cerrar sesión
 *     tags: [Notificacion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dispositivo dado de baja
 */
router.delete(
  '/dispositivo',
  authMiddleware,
  validate({ body: bajaDispositivoSchema }),
  controller.darDeBajaDispositivo
);

/**
 * @swagger
 * /notificacion/preferencias:
 *   get:
 *     summary: Preferencias de notificación del usuario
 *     tags: [Notificacion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Preferencias obtenidas
 */
router.get('/preferencias', authMiddleware, controller.obtenerPreferencias);

/**
 * @swagger
 * /notificacion/preferencias:
 *   put:
 *     summary: Actualizar preferencias de notificación
 *     tags: [Notificacion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Preferencias guardadas
 */
router.put(
  '/preferencias',
  authMiddleware,
  validate({ body: preferenciasSchema }),
  controller.guardarPreferencias
);

/**
 * @swagger
 * /notificacion/leer-todas:
 *   post:
 *     summary: Marcar todas las notificaciones como leídas
 *     tags: [Notificacion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notificaciones marcadas
 */
router.post('/leer-todas', authMiddleware, controller.marcarTodasLeidas);

/**
 * @swagger
 * /notificacion/{id}/leida:
 *   patch:
 *     summary: Marcar una notificación como leída
 *     tags: [Notificacion]
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
 *         description: Notificación marcada
 */
router.patch('/:id/leida', authMiddleware, validate({ params: idParamSchema }), controller.marcarLeida);

/**
 * @swagger
 * /notificacion:
 *   get:
 *     summary: Bandeja de notificaciones del usuario
 *     tags: [Notificacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limite
 *         schema:
 *           type: integer
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notificaciones obtenidas
 */
router.get('/', authMiddleware, validate({ query: listarQuerySchema }), controller.listar);

export default router;
