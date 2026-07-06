import { spawnSync } from 'node:child_process';
import pino from 'pino';
import { env } from './env.js';

// La consola de Windows usa CP850 por defecto y distorsiona los emojis/acentos
// UTF-8 de los logs; chcp hereda la consola del proceso y la cambia a UTF-8.
if (process.platform === 'win32') {
  spawnSync('chcp.com', ['65001'], { stdio: 'ignore' });
}

const isDevelopment = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});
