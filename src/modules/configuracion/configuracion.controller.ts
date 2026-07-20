import type { Request, Response, NextFunction } from 'express';
import { ConfiguracionService } from './configuracion.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';

export class ConfiguracionController {
  private service = new ConfiguracionService();

  obtener = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const config = await this.service.obtener();
      sendSuccess(res, 'Configuración del sistema recuperada con éxito.', config);
    } catch (error) {
      next(error);
    }
  };

  actualizar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const config = await this.service.actualizar(req.body);
      sendSuccess(res, 'Configuración del sistema actualizada con éxito.', config);
    } catch (error) {
      next(error);
    }
  };
}
