import os from 'node:os';
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/database.js';

/** Devuelve las IPv4 de red (LAN) de esta PC, las que debe usar el dispositivo/emulador. */
const getLanAddresses = (): string[] => {
  const nets = os.networkInterfaces();
  const addrs: string[] = [];
  for (const iface of Object.values(nets)) {
    for (const net of iface ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        addrs.push(net.address);
      }
    }
  }
  return addrs;
};

const startServer = async () => {
  try {
    // Probar conexión a la base de datos antes de levantar el servidor
    await prisma.$connect();
    logger.info('🔌 Conexión exitosa a la base de datos PostgreSQL');

    const server = app.listen(env.PORT, () => {
      logger.info(`🚀 Servidor ejecutándose en http://localhost:${env.PORT}`);
      logger.info(`📖 Swagger API Docs disponible en http://localhost:${env.PORT}/api-docs`);

      const lan = getLanAddresses();
      if (lan.length > 0) {
        logger.info(
          `📱 Desde el emulador/dispositivo usa la IP de la PC: ${lan
            .map((ip) => `http://${ip}:${env.PORT}`)
            .join('  |  ')}`
        );
      }
    });

    const shutdown = async () => {
      logger.info('关闭 ⏳ Apagando el servidor elegantemente...');
      server.close(async () => {
        await prisma.$disconnect();
        logger.info('🛑 Conexiones de base de datos cerradas. Servidor apagado.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.fatal(error, '💥 Falló la inicialización del servidor');
    process.exit(1);
  }
};

startServer();
