import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { loginSchema, registerSchema, refreshSchema, sendCodeSchema, changePasswordSchema, configureOrganizationSchema, resetPasswordSchema, aceptarInvitacionSchema, eliminarCuentaSchema } from './auth.schema.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';

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
router.post('/forgot-password', validate({ body: sendCodeSchema }), controller.forgotPassword);
router.post('/reset-password', validate({ body: resetPasswordSchema }), controller.resetPassword);

/**
 * @swagger
 * /auth/aceptar-invitacion:
 *   post:
 *     summary: Aceptar una invitación al equipo y fijar la contraseña propia
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, token, password]
 *             properties:
 *               email:
 *                 type: string
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invitación aceptada, se retornan tokens de sesión
 */
router.post('/aceptar-invitacion', validate({ body: aceptarInvitacionSchema }), controller.aceptarInvitacion);

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
router.post(
  '/configure-organization',
  authMiddleware,
  checkRole(['ADMIN', 'SUPER_ADMIN', 'GERENTE']),
  validate({ body: configureOrganizationSchema }),
  controller.configureOrganization
);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Cambiar la contraseña del usuario autenticado
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contraseña actualizada con éxito
 *       401:
 *         description: Contraseña actual incorrecta
 */
router.post('/change-password', authMiddleware, validate({ body: changePasswordSchema }), controller.changePassword);

/**
 * @swagger
 * /auth/account:
 *   delete:
 *     summary: Eliminar (borrado lógico) la propia cuenta del usuario autenticado
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cuenta eliminada con éxito
 *       400:
 *         description: Es el único administrador de la organización
 *       401:
 *         description: Contraseña incorrecta
 */
router.delete('/account', authMiddleware, validate({ body: eliminarCuentaSchema }), controller.eliminarCuenta);

export default router;
