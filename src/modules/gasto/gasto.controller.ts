import type { Request, Response, NextFunction } from 'express';
import { GastoService } from './gasto.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

export class GastoController {
  private gastoService = new GastoService();

  eliminar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = req.user?.organizacionId;
      if (!organizacionId) {
        throw new BadRequestError('Tu usuario no pertenece a ninguna organización.');
      }
      const actorId = req.user!.id;
      await this.gastoService.eliminar(organizacionId, req.params.id, actorId);
      sendSuccess(res, 'Gasto eliminado con éxito.');
    } catch (error) {
      next(error);
    }
  };
}
