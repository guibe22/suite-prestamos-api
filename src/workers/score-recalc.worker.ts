import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

/**
 * Réplica server-side de calcularPuntuacionYCalificacion
 * (suite-prestamos-app/src/utils/documentos.ts). No hay paquete compartido
 * entre la app y la API — si esa fórmula cambia allá, hay que replicar el
 * cambio aquí a mano. Corre server-side porque el cliente solo recalcula
 * tras un cobro/desembolso hecho en la app: si nadie visita a un cliente en
 * mucho tiempo, su score nunca se actualizaría.
 */
function calcularPuntuacionYCalificacion(
  cuotasVencidas: { fechaVencimiento: Date; montoTotal: number; montoPagado: number }[],
  prestamosLiquidados: number
): { puntuacion: number; calificacion: 'BUENO' | 'REGULAR' | 'RIESGOSO' } {
  let puntuacion = 100;

  if (cuotasVencidas.length > 0) {
    const hoy = Date.now();
    let penalizacion = 0;
    for (const c of cuotasVencidas) {
      const diasVencido = Math.max(0, Math.floor((hoy - c.fechaVencimiento.getTime()) / 86_400_000));
      const severidad = Math.min(25, 8 + Math.floor(diasVencido / 5) * 2);
      const saldoCuota = Math.max(0, c.montoTotal - c.montoPagado);
      const factorMonto = c.montoTotal > 0 ? Math.min(1.5, saldoCuota / c.montoTotal) : 1;
      penalizacion += severidad * factorMonto;
    }
    puntuacion -= penalizacion;
  }

  puntuacion += Math.min(15, prestamosLiquidados * 3);
  puntuacion = Math.max(10, Math.min(100, Math.round(puntuacion)));

  const calificacion = puntuacion >= 80 ? 'BUENO' : puntuacion >= 60 ? 'REGULAR' : 'RIESGOSO';
  return { puntuacion, calificacion };
}

async function recalcularScoresOrganizacion(): Promise<void> {
  const hoy = new Date();
  const clientes = await prisma.cliente.findMany({
    where: { deletedAt: null, calificacion: { not: 'BLOQUEADO' } },
    select: { id: true, puntuacion: true, calificacion: true },
  });

  let actualizados = 0;
  for (const cliente of clientes) {
    const [cuotasVencidas, prestamosLiquidados] = await Promise.all([
      prisma.cuota.findMany({
        where: {
          estado: 'PENDIENTE',
          fechaVencimiento: { lt: hoy },
          deletedAt: null,
          prestamo: { clienteId: cliente.id, deletedAt: null },
        },
        select: { fechaVencimiento: true, montoTotal: true, montoPagado: true },
      }),
      prisma.prestamo.count({
        where: { clienteId: cliente.id, estado: 'LIQUIDADO', deletedAt: null },
      }),
    ]);

    const { puntuacion, calificacion } = calcularPuntuacionYCalificacion(
      cuotasVencidas.map((c) => ({
        fechaVencimiento: c.fechaVencimiento,
        montoTotal: Number(c.montoTotal),
        montoPagado: Number(c.montoPagado),
      })),
      prestamosLiquidados
    );

    if (cliente.puntuacion !== puntuacion || cliente.calificacion !== calificacion) {
      await prisma.cliente.update({ where: { id: cliente.id }, data: { puntuacion, calificacion } });
      actualizados++;
    }
  }

  logger.info(`⏰ [score-recalc] ${actualizados}/${clientes.length} clientes actualizados.`);
}

export const startScoreRecalcWorker = (): void => {
  // 3:00 AM todos los días — fuera del horario de cobro, para no competir
  // por conexiones de base de datos con la app.
  cron.schedule('0 3 * * *', () => {
    recalcularScoresOrganizacion().catch((e) => logger.error(e, '💥 Error en score-recalc.worker'));
  });
  logger.info('⚙️ Score Recalc Worker programado (diario 3:00 AM).');
};

// Exportado solo para pruebas — no se usa en producción fuera de este archivo.
export { recalcularScoresOrganizacion, calcularPuntuacionYCalificacion };
