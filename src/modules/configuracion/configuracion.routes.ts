import { Router } from 'express';
import { ConfiguracionController } from './configuracion.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkRole } from '../../middlewares/permissions.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { actualizarConfiguracionSchema } from './configuracion.schema.js';

const router = Router();
const controller = new ConfiguracionController();

/**
 * @swagger
 * /configuracion/publica:
 *   get:
 *     summary: Subconjunto público (sin auth) — hoy solo minVersionApp, para el chequeo de versión antes de iniciar sesión
 *     tags: [Configuracion]
 *     responses:
 *       200:
 *         description: Configuración pública
 */
router.get('/publica', controller.publica);

// Ajustes globales de PLATAFORMA (ej. enforcement de suscripciones): solo
// SUPER_ADMIN, igual que /admin/planes. Va DESPUÉS de /publica a propósito —
// esta guarda solo aplica a las rutas registradas después de ella.
router.use(authMiddleware, checkRole(['SUPER_ADMIN']));

/**
 * @swagger
 * /configuracion:
 *   get:
 *     summary: Ajustes globales del sistema — solo SUPER_ADMIN
 *     tags: [Configuracion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Configuración actual
 */
router.get('/', controller.obtener);

/**
 * @swagger
 * /configuracion:
 *   patch:
 *     summary: Actualiza ajustes globales del sistema — solo SUPER_ADMIN
 *     tags: [Configuracion]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Configuración actualizada
 */
router.patch('/', validate({ body: actualizarConfiguracionSchema }), controller.actualizar);

export default router;
