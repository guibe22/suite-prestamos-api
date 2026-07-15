import type { Request, Response, NextFunction } from 'express';
import { PagoService } from './pago.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

export class PagoController {
  private pagoService = new PagoService();

  eliminar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = req.user?.organizacionId;
      if (!organizacionId) {
        throw new BadRequestError('Tu usuario no pertenece a ninguna organización.');
      }
      const actorId = req.user!.id;
      await this.pagoService.eliminar(organizacionId, req.params.id, actorId);
      sendSuccess(res, 'Pago eliminado con éxito.');
    } catch (error) {
      next(error);
    }
  };
}
