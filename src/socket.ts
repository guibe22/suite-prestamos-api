import type { Server } from 'node:http';
import { logger } from './config/logger.js';

export const initSocket = (server: Server) => {
  logger.info('🔌 Inicializando WebSockets (stub)...');
  // Aquí se configurará socket.io u otra librería en el futuro
  return server;
};
