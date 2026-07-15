import type { Request, Response, NextFunction } from 'express';
import { UsuarioService } from './usuario.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';
import { BadRequestError } from '../../shared/errors/custom.error.js';

export class UsuarioController {
  private usuarioService = new UsuarioService();

  private organizacionDelActor(req: Request): string {
    const organizacionId = req.user?.organizacionId;
    if (!organizacionId) {
      throw new BadRequestError('Tu usuario no pertenece a ninguna organización.');
    }
    return organizacionId;
  }

  listar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      const resultado = await this.usuarioService.listar(organizacionId);
      sendSuccess(res, 'Equipo recuperado con éxito.', resultado);
    } catch (error) {
      next(error);
    }
  };

  crear = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      const resultado = await this.usuarioService.crear(organizacionId, req.body);
      sendSuccess(res, 'Miembro del equipo creado con éxito.', resultado, undefined, 201);
    } catch (error) {
      next(error);
    }
  };

  actualizar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      const actorId = req.user!.id;
      const resultado = await this.usuarioService.actualizar(organizacionId, req.params.id, actorId, req.body);
      sendSuccess(res, 'Miembro del equipo actualizado con éxito.', resultado);
    } catch (error) {
      next(error);
    }
  };

  restablecerPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      const resultado = await this.usuarioService.restablecerPassword(organizacionId, req.params.id);
      sendSuccess(res, 'Contraseña restablecida con éxito.', resultado);
    } catch (error) {
      next(error);
    }
  };

  eliminar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizacionId = this.organizacionDelActor(req);
      await this.usuarioService.eliminar(organizacionId, req.params.id);
      sendSuccess(res, 'Miembro del equipo eliminado con éxito.');
    } catch (error) {
      next(error);
    }
  };
}
