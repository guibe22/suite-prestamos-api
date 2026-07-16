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

  sendCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.authService.sendVerificationCode(req.body.email);
      sendSuccess(res, 'Código de verificación enviado con éxito.');
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

  changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
        return;
      }
      await this.authService.changePassword(userId, req.body.currentPassword, req.body.newPassword);
      sendSuccess(res, 'Contraseña actualizada con éxito.');
    } catch (error) {
      next(error);
    }
  };

  configureOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
        return;
      }
      const result = await this.authService.configureOrganization(userId, req.body);
      sendSuccess(res, 'Organización configurada con éxito.', result);
    } catch (error) {
      next(error);
    }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.authService.sendForgotPasswordCode(req.body.email);
      sendSuccess(res, 'Código de recuperación de contraseña enviado con éxito.');
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.authService.resetPassword(req.body);
      sendSuccess(res, 'Contraseña restablecida con éxito.');
    } catch (error) {
      next(error);
    }
  };

  aceptarInvitacion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.aceptarInvitacion(req.body.email, req.body.token, req.body.password);
      sendSuccess(res, 'Invitación aceptada con éxito.', result);
    } catch (error) {
      next(error);
    }
  };

  eliminarCuenta = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
        return;
      }
      await this.authService.eliminarCuenta(userId, req.body.password);
      sendSuccess(res, 'Cuenta eliminada con éxito.');
    } catch (error) {
      next(error);
    }
  };
}
