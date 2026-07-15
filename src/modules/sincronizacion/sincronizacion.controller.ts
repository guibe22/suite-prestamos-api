import type { Request, Response, NextFunction } from 'express';
import { SincronizacionService } from './sincronizacion.service.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

export class SincronizacionController {
  private sincronizacionService = new SincronizacionService();

  pull = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = req.user?.organizacionId;
      const actorId = req.user?.id;
      const actorRol = req.user?.rol;
      if (!organizacionId || !actorId || !actorRol) {
        throw new BadRequestError('El usuario debe pertenecer a una organización para sincronizar.');
      }

      // WatermelonDB envía last_pulled_at como query param (milisegundos)
      const lastPulledAtStr = req.query.last_pulled_at as string;
      const lastPulledAt = lastPulledAtStr ? Number(lastPulledAtStr) : 0;

      if (isNaN(lastPulledAt)) {
        throw new BadRequestError('El parámetro last_pulled_at debe ser un número válido.');
      }

      const result = await this.sincronizacionService.pull(lastPulledAt, organizacionId, actorId, actorRol);
      
      // Retornar formato nativo que espera WatermelonDB
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  push = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = req.user?.organizacionId;
      const userId = req.user?.id;
      const userRol = req.user?.rol;

      if (!organizacionId || !userId || !userRol) {
        throw new BadRequestError('Usuario no autenticado o sin organización asociada.');
      }

      const { changes } = req.body;
      if (!changes) {
        throw new BadRequestError('No se proporcionaron cambios para sincronizar.');
      }

      await this.sincronizacionService.push(changes, organizacionId, userId, userRol);

      // Responder con estado 200 (sin contenido) o 204 como lo espera WatermelonDB
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
