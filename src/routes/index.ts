import { Router } from 'express';
import { authRoutes } from '../modules/auth/index.js';
import { cuentaRoutes } from '../modules/cuenta/index.js';
import { organizacionRoutes } from '../modules/organizacion/index.js';
import { usuarioRoutes } from '../modules/usuario/index.js';
import { rolRoutes } from '../modules/rol/index.js';
import { clienteRoutes } from '../modules/cliente/index.js';
import { rutaRoutes } from '../modules/ruta/index.js';
import { referenciaRoutes } from '../modules/referencia/index.js';
import { documentoRoutes } from '../modules/documento/index.js';
import { prestamoRoutes } from '../modules/prestamo/index.js';
import { cuotaRoutes } from '../modules/cuota/index.js';
import { pagoRoutes } from '../modules/pago/index.js';
import { cajaRoutes } from '../modules/caja/index.js';
import { movimientocajaRoutes } from '../modules/movimiento-caja/index.js';
import { gastoRoutes } from '../modules/gasto/index.js';
import { configuracionRoutes } from '../modules/configuracion/index.js';
import { auditoriaRoutes } from '../modules/auditoria/index.js';
import { sincronizacionRoutes } from '../modules/sincronizacion/index.js';
import { notificacionRoutes } from '../modules/notificacion/index.js';
import { suscripcionRoutes } from '../modules/suscripcion/index.js';
import { adminPlanRoutes } from '../modules/admin-plan/index.js';

const router = Router();

// Registro de Rutas
router.use('/auth', authRoutes);
router.use('/cuenta', cuentaRoutes);
router.use('/organizacion', organizacionRoutes);
router.use('/usuario', usuarioRoutes);
router.use('/rol', rolRoutes);
router.use('/cliente', clienteRoutes);
router.use('/ruta', rutaRoutes);
router.use('/referencia', referenciaRoutes);
router.use('/documento', documentoRoutes);
router.use('/prestamo', prestamoRoutes);
router.use('/cuota', cuotaRoutes);
router.use('/pago', pagoRoutes);
router.use('/caja', cajaRoutes);
router.use('/movimiento-caja', movimientocajaRoutes);
router.use('/gasto', gastoRoutes);
router.use('/configuracion', configuracionRoutes);
router.use('/auditoria', auditoriaRoutes);
router.use('/sincronizacion', sincronizacionRoutes);
router.use('/notificacion', notificacionRoutes);
router.use('/suscripcion', suscripcionRoutes);
router.use('/admin/planes', adminPlanRoutes);

export default router;
