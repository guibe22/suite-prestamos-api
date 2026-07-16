import type { Request, Response, NextFunction } from 'express';
import { SuscripcionService } from './suscripcion.service.js';
import { verificarFirmaWebhook } from './paypal.client.js';
import { decodificarNotificacionRtdn } from './google-play.client.js';
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

  iniciarPaypal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      const { planId, returnUrl, cancelUrl } = req.body;
      const resultado = await this.suscripcionService.iniciarSuscripcionPaypal(
        organizacionId,
        planId,
        returnUrl,
        cancelUrl,
      );
      sendSuccess(res, 'Suscripción de PayPal iniciada.', resultado);
    } catch (error) {
      next(error);
    }
  };

  /** Llamada externa de PayPal: sin authMiddleware, autenticada por firma. */
  paypalWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const headers = {
        transmissionId: req.header('paypal-transmission-id') || '',
        transmissionTime: req.header('paypal-transmission-time') || '',
        certUrl: req.header('paypal-cert-url') || '',
        authAlgo: req.header('paypal-auth-algo') || '',
        transmissionSig: req.header('paypal-transmission-sig') || '',
      };

      const esValido = await verificarFirmaWebhook(headers, req.body);
      if (!esValido) {
        throw new BadRequestError('Firma de webhook de PayPal inválida.');
      }

      await this.suscripcionService.procesarEventoPaypal(req.body);
      res.status(200).send();
    } catch (error) {
      next(error);
    }
  };

  verificarCompraGoogle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      const { purchaseToken, productId } = req.body;
      const resultado = await this.suscripcionService.verificarCompraGoogle(
        organizacionId,
        purchaseToken,
        productId,
      );
      sendSuccess(res, 'Compra de Google Play verificada.', resultado);
    } catch (error) {
      next(error);
    }
  };

  /** Push de Pub/Sub (RTDN): sin authMiddleware, es una llamada externa de Google. */
  googleRtdn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const notificacion = decodificarNotificacionRtdn(req.body);
      if (!notificacion) {
        // Payload no reconocido: se responde 200 para que Pub/Sub no reintente.
        res.status(200).send();
        return;
      }

      const messageId: string = req.body?.message?.messageId || `${notificacion.purchaseToken}:${notificacion.notificationType}`;
      await this.suscripcionService.procesarNotificacionGoogle(
        messageId,
        notificacion.purchaseToken,
        notificacion.notificationType,
      );
      res.status(200).send();
    } catch (error) {
      next(error);
    }
  };
}
