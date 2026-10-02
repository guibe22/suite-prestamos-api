import type { Request, Response, NextFunction } from 'express';
import { SuscripcionService } from './suscripcion.service.js';
import { verificarAutorizacionWebhook } from './revenuecat.client.js';
import { sendSuccess } from '../../shared/responses/api.response.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

export class SuscripcionController {
  private suscripcionService = new SuscripcionService();

  private organizacionDelActor(req: Request): string {
    const organizacionId = req.user?.organizacionId;
    if (!organizacionId) {
      throw new BadRequestError('Tu usuario no pertenece a ninguna organización.');
    }
    return organizacionId;
  }

  miSuscripcion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      const resultado = await this.suscripcionService.obtenerMiSuscripcion(organizacionId);
      sendSuccess(res, 'Suscripción recuperada con éxito.', resultado);
    } catch (error) {
      next(error);
    }
  };

  planes = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resultado = await this.suscripcionService.listarPlanesActivos();
      sendSuccess(res, 'Planes disponibles.', resultado);
    } catch (error) {
      next(error);
    }
  };

  config = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resultado = this.suscripcionService.obtenerConfigCliente();
      sendSuccess(res, 'Configuración de cliente recuperada con éxito.', resultado);
    } catch (error) {
      next(error);
    }
  };

  /** Llamada externa de RevenueCat: sin authMiddleware, autenticada por el header Authorization. */
  /**
   * Fuerza una reconciliación contra RevenueCat para la organización del
   * usuario. La app la llama cuando acaba de comprar y el webhook todavía no
   * se ha reflejado: sin esto, un evento perdido dejaba al usuario pagando
   * sin plan y sin forma de arreglarlo.
   */
  reconciliar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      const resultado = await this.suscripcionService.reconciliarConRevenueCat(organizacionId);
      const suscripcion = await this.suscripcionService.obtenerMiSuscripcion(organizacionId);
      sendSuccess(res, resultado.motivo, { ...resultado, suscripcion });
    } catch (error) {
      next(error);
    }
  };

  revenuecatWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const esValido = verificarAutorizacionWebhook(req.header('authorization'));
      if (!esValido) {
        throw new BadRequestError('Autorización de webhook de RevenueCat inválida.');
      }

      // Antes se pasaba `req.body?.event` directo: un body malformado llegaba
      // como undefined y reventaba con un TypeError (HTTP 500), que RevenueCat
      // interpreta como fallo nuestro y reintenta en bucle. Es un 400.
      const evento = req.body?.event;
      if (!evento || typeof evento !== 'object' || !evento.id || !evento.app_user_id) {
        throw new BadRequestError('El evento de RevenueCat no tiene la forma esperada.');
      }

      await this.suscripcionService.procesarEventoRevenueCat(evento);
      res.status(200).send();
    } catch (error) {
      next(error);
    }
  };
}
