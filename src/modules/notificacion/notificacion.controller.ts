import type { Request, Response, NextFunction } from 'express';
import { NotificacionService } from './notificacion.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

export class NotificacionController {
  private service = new NotificacionService();

  /**
   * Organización del JWT. Todos los endpoints de bandeja la exigen: sin ella
   * no hay forma de acotar el alcance y devolver datos sería un IDOR.
   */
  private organizacionDe(req: Request): string {
    const organizacionId = req.user?.organizacionId;
    if (!organizacionId) {
      throw new BadRequestError('Tu usuario no pertenece a ninguna organización.');
    }
    return organizacionId;
  }

  registrarDispositivo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dispositivo = await this.service.registrarDispositivo({
        usuarioId: req.user!.id,
        token: req.body.token,
        plataforma: req.body.plataforma,
        appVersion: req.body.appVersion,
      });
      sendSuccess(res, 'Dispositivo registrado para notificaciones.', dispositivo);
    } catch (error) {
      next(error);
    }
  };

  darDeBajaDispositivo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.darDeBajaDispositivo(req.user!.id, req.body.token);
      sendSuccess(res, 'Dispositivo dado de baja.');
    } catch (error) {
      next(error);
    }
  };

  listar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resultado = await this.service.listar({
        organizacionId: this.organizacionDe(req),
        usuarioId: req.user!.id,
        limite: req.query.limite as number | undefined,
        cursor: req.query.cursor as string | undefined,
      });
      sendSuccess(res, 'Notificaciones obtenidas.', resultado);
    } catch (error) {
      next(error);
    }
  };

  marcarLeida = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.marcarLeida(this.organizacionDe(req), req.user!.id, req.params.id);
      sendSuccess(res, 'Notificación marcada como leída.');
    } catch (error) {
      next(error);
    }
  };

  marcarTodasLeidas = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resultado = await this.service.marcarTodasLeidas(this.organizacionDe(req), req.user!.id);
      sendSuccess(res, 'Notificaciones marcadas como leídas.', resultado);
    } catch (error) {
      next(error);
    }
  };

  obtenerPreferencias = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const preferencias = await this.service.obtenerPreferencias(req.user!.id);
      sendSuccess(res, 'Preferencias obtenidas.', preferencias);
    } catch (error) {
      next(error);
    }
  };

  guardarPreferencias = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (Object.keys(req.body ?? {}).length === 0) {
        throw new BadRequestError('No se envió ninguna preferencia para actualizar.');
      }
      const preferencias = await this.service.guardarPreferencias(req.user!.id, req.body);
      sendSuccess(res, 'Preferencias guardadas.', preferencias);
    } catch (error) {
      next(error);
    }
  };
}
