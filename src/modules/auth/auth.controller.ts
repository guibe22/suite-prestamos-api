import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { sendSuccess } from '../../shared/responses/api.response.js';

export class AuthController {
  private authService = new AuthService();

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.login(req.body);
      sendSuccess(res, 'Sesión iniciada correctamente.', result);
    } catch (error) {
      next(error);
    }
  };

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.register(req.body);
      sendSuccess(res, 'Usuario registrado y cuenta creada con éxito.', result, undefined, 201);
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.refresh(req.body.refreshToken);
      sendSuccess(res, 'Tokens renovados con éxito.', result);
    } catch (error) {
      next(error);
    }
  };

  profile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
        return;
      }
      const profile = await this.authService.getProfile(userId);
      sendSuccess(res, 'Perfil del usuario recuperado con éxito.', profile);
    } catch (error) {
      next(error);
    }
  };
}
