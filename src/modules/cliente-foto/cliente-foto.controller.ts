import type { Request, Response, NextFunction } from 'express';
import { ClienteFotoService } from './cliente-foto.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

function organizacionDe(req: Request): string {
  const organizacionId = req.user?.organizacionId;
  if (!organizacionId) {
    throw new BadRequestError('Tu usuario no pertenece a ninguna organización.');
  }
  return organizacionId;
}

export class ClienteFotoController {
  private service = new ClienteFotoService();

  obtener = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.service.obtener(organizacionDe(req), req.params.clienteId, req.user!.id, req.user!.rol);
      // Dato personal sensible: que ningún proxy ni el navegador lo guarde.
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, 'Foto de la cédula.', data);
    } catch (error) {
      next(error);
    }
  };

  guardar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.service.guardar(
        organizacionDe(req),
        req.params.clienteId,
        req.body.imagenBase64,
        req.user!.id,
        req.user!.rol
      );
      sendSuccess(res, 'Foto de la cédula guardada.', data);
    } catch (error) {
      next(error);
    }
  };

  eliminar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.eliminar(organizacionDe(req), req.params.clienteId, req.user!.id, req.user!.rol);
      sendSuccess(res, 'Foto de la cédula eliminada.');
    } catch (error) {
      next(error);
    }
  };
}
