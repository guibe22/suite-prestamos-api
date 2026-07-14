import { Router } from 'express';
import { UsuarioController } from './usuario.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { crearUsuarioSchema, actualizarUsuarioSchema, idParamSchema } from './usuario.schema.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';

const router = Router();
const controller = new UsuarioController();

router.use(authMiddleware, checkRole(['ADMIN', 'SUPER_ADMIN']));

/**
 * @swagger
 * /usuario:
 *   get:
 *     summary: Listar el equipo (cobradores/cajeros) de la organización del usuario autenticado
 *     tags: [Usuario]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de miembros del equipo
 */
router.get('/', controller.listar);

/**
 * @swagger
 * /usuario:
 *   post:
 *     summary: Crear un nuevo miembro del equipo (COBRADOR o CAJERO)
 *     tags: [Usuario]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, email, rol]
 *             properties:
 *               nombre:
 *                 type: string
 *               email:
 *                 type: string
 *               rol:
 *                 type: string
 *                 enum: [COBRADOR, CAJERO]
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Miembro creado con éxito
 */
router.post('/', validate({ body: crearUsuarioSchema }), controller.crear);

/**
 * @swagger
 * /usuario/{id}:
 *   patch:
 *     summary: Editar nombre/rol o activar-desactivar un miembro del equipo
 *     tags: [Usuario]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               rol:
 *                 type: string
 *                 enum: [COBRADOR, CAJERO]
 *               activo:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Miembro actualizado con éxito
 */
router.patch('/:id', validate({ params: idParamSchema, body: actualizarUsuarioSchema }), controller.actualizar);

export default router;
