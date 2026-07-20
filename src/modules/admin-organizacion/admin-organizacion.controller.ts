import type { Request, Response, NextFunction } from 'express';
import { AdminOrganizacionService } from './admin-organizacion.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';

export class AdminOrganizacionController {
  private service = new AdminOrganizacionService();

  listar = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizaciones = await this.service.listar();
      sendSuccess(res, 'Organizaciones recuperadas con éxito.', organizaciones);
    } catch (error) {
      next(error);
    }
  };

  actualizarSuscripcion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const suscripcion = await this.service.actualizarSuscripcion(req.params.id, req.body);
      sendSuccess(res, 'Suscripción de la organización actualizada con éxito.', suscripcion);
    } catch (error) {
      next(error);
    }
  };
}
