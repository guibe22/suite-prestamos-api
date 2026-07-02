import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { loginSchema, registerSchema, refreshSchema, sendCodeSchema } from './auth.schema.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = Router();
const controller = new AuthController();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registrar una nueva cuenta y organización
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, email, password]
 *             properties:
 *               nombre:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               organizacionNombre:
 *                 type: string
 *     responses:
 *       201:
 *         description: Usuario y organización creados exitosamente
 */
router.post('/send-code', validate({ body: sendCodeSchema }), controller.sendCode);
router.post('/register', validate({ body: registerSchema }), controller.register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Iniciar sesión de usuario
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Credenciales correctas, se retornan tokens
 */
router.post('/login', validate({ body: loginSchema }), controller.login);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Renovar tokens de acceso usando refresh token
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nuevos tokens generados con éxito
 */
router.post('/refresh', validate({ body: refreshSchema }), controller.refresh);

/**
 * @swagger
 * /auth/profile:
 *   get:
 *     summary: Obtener el perfil del usuario autenticado
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Retorna el perfil del usuario
 */
router.get('/profile', authMiddleware, controller.profile);

export default router;
