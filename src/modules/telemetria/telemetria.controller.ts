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

      const {
        latitud,
        longitud,
        rumbo,
        velocidadKmH,
        bateria,
        estado,
        rutaId,
        rutaNombre,
        estadoUbicacion,
        estadoUbicacionDesde,
      } = req.body;

      // Sin coordenadas solo vale un ping que avisa del estado de la ubicación
      // (GPS apagado, permiso quitado): es justo cuando no puede haber posición.
      const sinCoordenadas = latitud === undefined || longitud === undefined;
      if (sinCoordenadas && !estadoUbicacion) {
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
        estadoUbicacion,
        estadoUbicacionDesde,
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

  /** Cambios de estado de la ubicación (GPS apagado, permiso quitado, GPS falso). */
  listarEventos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = req.user?.organizacionId;
      if (!organizacionId) {
        throw new BadRequestError('Organización no identificada.');
      }

      const usuarioId = typeof req.query.usuarioId === 'string' ? req.query.usuarioId : undefined;
      const desde = Number(req.query.desde);
      const eventos = await this.service.obtenerEventos(organizacionId, {
        usuarioId,
        desde: Number.isFinite(desde) && desde > 0 ? desde : undefined,
      });
      res.status(200).json({ ok: true, eventos });
    } catch (error) {
      next(error);
    }
  };
}
