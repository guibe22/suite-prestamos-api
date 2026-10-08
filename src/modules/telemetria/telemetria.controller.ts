import type { Request, Response, NextFunction } from 'express';
import { TelemetriaService } from './telemetria.service.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

export class TelemetriaController {
  private service = new TelemetriaService();

  ping = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const usuarioId = req.user?.id;
      const organizacionId = req.user?.organizacionId;

      if (!usuarioId || !organizacionId) {
        throw new BadRequestError('Sesión inválida para reportar telemetría.');
      }

      const { latitud, longitud, rumbo, velocidadKmH, bateria, estado, rutaId, rutaNombre } = req.body;

      if (latitud === undefined || longitud === undefined) {
        throw new BadRequestError('Las coordenadas (latitud y longitud) son obligatorias.');
      }

      const record = await this.service.reportarPing(usuarioId, organizacionId, {
        latitud,
        longitud,
        rumbo,
        velocidadKmH,
        bateria,
        estado,
        rutaId,
        rutaNombre,
      });

      res.status(200).json({ ok: true, timestamp: record.actualizadoEn });
    } catch (error) {
      next(error);
    }
  };

  listarActivos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = req.user?.organizacionId;
      if (!organizacionId) {
        throw new BadRequestError('Organización no identificada.');
      }

      const cobradores = this.service.obtenerActivos(organizacionId);
      res.status(200).json({ ok: true, cobradores });
    } catch (error) {
      next(error);
    }
  };
}
