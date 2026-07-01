import type { Response } from 'express';

export interface StandardResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  meta?: unknown;
  errors?: unknown[];
}

export const sendSuccess = <T>(
  res: Response,
  message = 'Operación realizada correctamente.',
  data?: T,
  meta?: unknown,
  statusCode = 200,
): Response => {
  const responseBody: StandardResponse<T> = {
    success: true,
    message,
    data,
    meta,
  };
  return res.status(statusCode).json(responseBody);
};

export const sendError = (
  res: Response,
  message: string,
  errors: unknown[] = [],
  statusCode = 500,
): Response => {
  const responseBody: StandardResponse = {
    success: false,
    message,
    errors,
  };
  return res.status(statusCode).json(responseBody);
};
