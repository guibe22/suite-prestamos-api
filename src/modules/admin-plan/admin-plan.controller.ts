import type { Request, Response, NextFunction } from 'express';
import { AdminPlanService } from './admin-plan.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';

export class AdminPlanController {
  private service = new AdminPlanService();

  listar = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const planes = await this.service.listar();
      sendSuccess(res, 'Planes recuperados con éxito.', planes);
    } catch (error) {
      next(error);
    }
  };

  crear = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plan = await this.service.crear(req.body);
      sendSuccess(res, 'Plan creado con éxito.', plan, undefined, 201);
    } catch (error) {
      next(error);
    }
  };

  actualizar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plan = await this.service.actualizar(req.params.id, req.body);
      sendSuccess(res, 'Plan actualizado con éxito.', plan);
    } catch (error) {
      next(error);
    }
  };

  generarEnPaypal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plan = await this.service.generarEnPaypal(req.params.id);
      sendSuccess(res, 'Plan generado en PayPal con éxito.', plan);
    } catch (error) {
      next(error);
    }
  };
}
