import { AuthRepository } from './auth.repository.js';
import { comparePassword, hashPassword } from '../../utils/bcrypt.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from '../../shared/errors/custom.error.js';
import type { LoginInput, RegisterInput, UserSessionResponse } from './auth.types.js';

export class AuthService {
  private authRepository = new AuthRepository();

  async login(data: LoginInput): Promise<UserSessionResponse> {
    const user = await this.authRepository.findByEmail(data.email);

    if (!user) {
      throw new UnauthorizedError('Credenciales incorrectas.');
    }

    const isPasswordValid = await comparePassword(data.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Credenciales incorrectas.');
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      rol: user.rol.nombre,
      organizacionId: user.organizacionId || undefined,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol.nombre,
      organizacionId: user.organizacionId,
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  async register(data: RegisterInput): Promise<UserSessionResponse> {
    const existingUser = await this.authRepository.findByEmail(data.email);
    if (existingUser) {
      throw new ConflictError('El correo electrónico ya está registrado.');
    }

    const rol = await this.authRepository.findRoleByName(data.rolNombre);
    if (!rol) {
      throw new BadRequestError(`El rol '${data.rolNombre}' no es válido.`);
    }

    const passwordHash = await hashPassword(data.password);
    const { usuario } = await this.authRepository.createUserWithNewOrganization({
      ...data,
      passwordHash,
      rolId: rol.id,
    });

    const tokenPayload = {
      id: usuario.id,
      email: usuario.email,
      rol: usuario.rol.nombre,
      organizacionId: usuario.organizacionId || undefined,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    return {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol.nombre,
      organizacionId: usuario.organizacionId,
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  async refresh(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const decoded = verifyRefreshToken(token);

      const user = await this.authRepository.findUserById(decoded.id);
      if (!user) {
        throw new UnauthorizedError('Usuario no encontrado o inactivo.');
      }

      const tokenPayload = {
        id: user.id,
        email: user.email,
        rol: user.rol.nombre,
        organizacionId: user.organizacionId || undefined,
      };

      const newAccessToken = generateAccessToken(tokenPayload);
      const newRefreshToken = generateRefreshToken(tokenPayload);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new UnauthorizedError('Token de actualización no válido o expirado.');
    }
  }

  async getProfile(userId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedError('Usuario no encontrado.');
    }

    return {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol.nombre,
      organizacion: user.organizacion
        ? {
            id: user.organizacion.id,
            nombre: user.organizacion.nombre,
          }
        : null,
    };
  }
}
