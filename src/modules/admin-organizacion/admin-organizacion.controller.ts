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

  buscarRegistros = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tipo, search, page, limit } = req.query as { tipo: string; search?: string; page?: string; limit?: string };
      const { data, meta } = await this.service.buscarRegistrosSoporte(
        req.params.id,
        tipo || 'PAGO',
        search,
        page ? Number(page) : 1,
        limit ? Number(limit) : 10
      );
      sendSuccess(res, 'Registros recuperados con éxito.', data, meta);
    } catch (error) {
      next(error);
    }
  };

  obtenerDetalleJornada = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const detalle = await this.service.obtenerDetalleJornada(req.params.id, req.params.jornadaId);
      sendSuccess(res, 'Detalle de la jornada recuperado con éxito.', detalle);
    } catch (error) {
      next(error);
    }
  };

  eliminarRegistro = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tipo, registroId } = req.body;
      const resultado = await this.service.eliminarRegistroSoporte(req.params.id, tipo, registroId, req.user!.id);
      sendSuccess(res, resultado.mensaje, resultado);
    } catch (error) {
      next(error);
    }
  };

  exportarDatos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const datos = await this.service.exportarClientesYPrestamos(req.params.id);
      sendSuccess(res, 'Estructura de clientes y préstamos exportada con éxito.', datos);
    } catch (error) {
      next(error);
    }
  };

  importarDatos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resultado = await this.service.importarClientesYPrestamos(req.params.id, req.body);
      sendSuccess(res, 'Clientes y préstamos importados con éxito.', resultado);
    } catch (error) {
      next(error);
    }
  };

  listarRutas = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rutas = await this.service.listarRutas(req.params.id);
      sendSuccess(res, 'Rutas recuperadas con éxito.', rutas);
    } catch (error) {
      next(error);
    }
  };

  incluirPrestamoEnJornada = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resultado = await this.service.incluirPrestamoEnJornada(req.params.id, req.params.prestamoId);
      sendSuccess(res, resultado.mensaje, resultado);
    } catch (error) {
      next(error);
    }
  };
}
