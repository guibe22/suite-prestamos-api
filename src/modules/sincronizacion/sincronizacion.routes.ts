import { Router } from 'express';
import { SincronizacionController } from './sincronizacion.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requireActiveSubscription } from '../../middlewares/suscripcion.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { pushSchema } from './sincronizacion.schema.js';

const router = Router();
const controller = new SincronizacionController();

// Ruta para obtener cambios desde el servidor (Pull) — nunca se bloquea por
// suscripción, para no dejar a un dispositivo sin poder ver sus propios datos.
router.get('/pull', authMiddleware, controller.pull);

// Ruta para enviar cambios desde el cliente (Push): aquí es donde en la
// práctica se crean/actualizan clientes, préstamos, cuotas, pagos, cajas,
// rutas y jornadas (esos módulos REST son placeholders sin implementar), así
// que este es el punto de enforcement real para el crecimiento de uso.
router.post('/push', authMiddleware, requireActiveSubscription(), validate({ body: pushSchema }), controller.push);

export default router;
