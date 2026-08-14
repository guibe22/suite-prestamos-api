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
      await this.pagoService.eliminar(organizacionId, req.params.id, actorId, req.user!.rol);
      sendSuccess(res, 'Pago eliminado con éxito.');
    } catch (error) {
      next(error);
    }
  };

  recalcularPrestamoAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = req.user?.organizacionId;
      if (!organizacionId) {
        throw new BadRequestError('Tu usuario no pertenece a ninguna organización.');
      }
      const { prestamoId } = req.params;
      const { cuotasIniciales } = req.body || {};
      const numCuotasIniciales = typeof cuotasIniciales === 'number' ? cuotasIniciales : (cuotasIniciales ? parseInt(cuotasIniciales, 10) : undefined);

      await this.pagoService.recalcularPrestamoAdmin(organizacionId, prestamoId, numCuotasIniciales, req.user!.id, req.user!.rol);
      sendSuccess(res, 'Préstamo recalculado y restaurado con éxito.');
    } catch (error) {
      next(error);
    }
  };
}
