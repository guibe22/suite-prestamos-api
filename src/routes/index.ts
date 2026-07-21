import { Router } from 'express';
import { authRoutes } from '../modules/auth/index.js';
import { usuarioRoutes } from '../modules/usuario/index.js';
import { rutaRoutes } from '../modules/ruta/index.js';
import { pagoRoutes } from '../modules/pago/index.js';
import { gastoRoutes } from '../modules/gasto/index.js';
import { configuracionRoutes } from '../modules/configuracion/index.js';
import { sincronizacionRoutes } from '../modules/sincronizacion/index.js';
import { suscripcionRoutes } from '../modules/suscripcion/index.js';
import { adminPlanRoutes } from '../modules/admin-plan/index.js';
import { adminOrganizacionRoutes } from '../modules/admin-organizacion/index.js';

// Nota: cliente, prestamo, caja, cuota, documento, referencia, notificacion,
// auditoria, movimiento-caja, rol, cuenta y organizacion NO tienen módulo REST
// — todas sus mutaciones ocurren vía POST /sincronizacion/push (WatermelonDB
// sync). Existieron como placeholders vacíos (sin un solo handler) y se
// eliminaron para no dejar superficie muerta/confusa en el repo.

const router = Router();

// Registro de Rutas
router.use('/auth', authRoutes);
router.use('/usuario', usuarioRoutes);
router.use('/ruta', rutaRoutes);
router.use('/pago', pagoRoutes);
router.use('/gasto', gastoRoutes);
router.use('/configuracion', configuracionRoutes);
router.use('/sincronizacion', sincronizacionRoutes);
router.use('/suscripcion', suscripcionRoutes);
router.use('/admin/planes', adminPlanRoutes);
router.use('/admin/organizaciones', adminOrganizacionRoutes);

export default router;
