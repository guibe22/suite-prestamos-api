import cron from 'node-cron';
import { logger } from '../config/logger.js';
import { SuscripcionService } from '../modules/suscripcion/suscripcion.service.js';

const suscripcionService = new SuscripcionService();

export const startSuscripcionVencimientoWorker = (): void => {
  // 3:30 AM todos los días — justo después del score-recalc worker (3:00 AM).
  cron.schedule('30 3 * * *', () => {
    suscripcionService
      .procesarVencimientosManuales()
      .then(({ suspendidos }) => {
        logger.info(`⏰ [suscripcion-vencimiento] ${suspendidos} suscripción(es) suspendida(s).`);
      })
      .catch((e) => logger.error(e, '💥 Error en suscripcion-vencimiento.worker'));
  });
  logger.info('⚙️ Suscripción Vencimiento Worker programado (diario 3:30 AM).');
};
