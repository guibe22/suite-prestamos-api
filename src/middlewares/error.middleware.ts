import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors/custom.error.js';
import { sendError } from '../shared/responses/api.response.js';
import { logger } from '../config/logger.js';
import { z } from 'zod';

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  logger.error(
    {
      err: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      method: req.method,
      url: req.url,
    },
    'Error en petición',
  );

  // Manejar AppError (nuestros errores personalizados)
  if (err instanceof AppError) {
    sendError(res, err.message, err.errors, err.statusCode);
    return;
  }

  // Manejar ZodError (validaciones)
  if (err instanceof z.ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    sendError(res, 'Error de validación de datos.', errors, 400);
    return;
  }

  // Errores generales
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Ocurrió un error interno en el servidor.'
      : err.message;

  sendError(res, message, [], 500);
};
