import { Router } from 'express';
import { ClienteFotoController } from './cliente-foto.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { checkPermission } from '../../middlewares/permissions.middleware.js';
import { clienteIdParamSchema, guardarFotoCedulaSchema } from './cliente-foto.schema.js';

const router = Router();
const controller = new ClienteFotoController();

/**
 * @swagger
 * /cliente/{clienteId}/foto-cedula:
 *   get:
 *     summary: Foto del frente de la cédula del cliente (se descarga bajo demanda, no viaja por sync)
 *     tags: [Cliente]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ imagenBase64, mimeType, bytes, actualizadaEn }"
 *       403:
 *         description: La función no está habilitada para la organización
 *       404:
 *         description: El cliente no existe, no es accesible o no tiene foto
 */
router.get(
  '/:clienteId/foto-cedula',
  authMiddleware,
  checkPermission('clientes:ver'),
  validate({ params: clienteIdParamSchema }),
  controller.obtener
);

/**
 * @swagger
 * /cliente/{clienteId}/foto-cedula:
 *   put:
 *     summary: Guarda o reemplaza la foto de la cédula (JPEG en base64, máx. 400 KB)
 *     tags: [Cliente]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Foto guardada
 *       400:
 *         description: No es JPEG o excede el tamaño
 *       403:
 *         description: La función no está habilitada para la organización
 */
router.put(
  '/:clienteId/foto-cedula',
  authMiddleware,
  checkPermission('clientes:editar'),
  validate({ params: clienteIdParamSchema, body: guardarFotoCedulaSchema }),
  controller.guardar
);

/**
 * @swagger
 * /cliente/{clienteId}/foto-cedula:
 *   delete:
 *     summary: Elimina la foto de la cédula del cliente
 *     tags: [Cliente]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Foto eliminada
 */
router.delete(
  '/:clienteId/foto-cedula',
  authMiddleware,
  checkPermission('clientes:editar'),
  validate({ params: clienteIdParamSchema }),
  controller.eliminar
);

export default router;
