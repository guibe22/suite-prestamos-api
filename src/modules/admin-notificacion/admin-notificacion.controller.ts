import type { Request, Response, NextFunction } from 'express';
import { AdminNotificacionService } from './admin-notificacion.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';

export class AdminNotificacionController {
  private service = new AdminNotificacionService();

  enviarAnuncio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resultado = await this.service.enviarAnuncio({
        organizacionId: req.body.organizacionId ?? null,
        categoria: req.body.categoria,
        titulo: req.body.titulo,
        cuerpo: req.body.cuerpo,
        ruta: req.body.ruta,
      });
      sendSuccess(res, 'Anuncio enviado.', resultado);
    } catch (error) {
      next(error);
    }
  };

  diagnostico = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const datos = await this.service.diagnostico(req.query.dias as number | undefined);
      sendSuccess(res, 'Diagnóstico de notificaciones.', datos);
    } catch (error) {
      next(error);
    }
  };
}
