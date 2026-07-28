import type { Request, Response, NextFunction } from 'express';
import { AdminOrganizacionService } from './admin-organizacion.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';

export class AdminOrganizacionController {
  private service = new AdminOrganizacionService();

  listar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { data, meta } = await this.service.listar(req.query as any);
      sendSuccess(res, 'Organizaciones recuperadas con éxito.', data, meta);
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

  listarAuditoria = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const registros = await this.service.listarAuditoria(req.params.id);
      sendSuccess(res, 'Bitácora de auditoría recuperada con éxito.', registros);
    } catch (error) {
      next(error);
    }
  };
}
