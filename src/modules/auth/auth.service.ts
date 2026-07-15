import { randomBytes } from 'node:crypto';
import { AuthRepository } from './auth.repository.js';
import { prisma } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { comparePassword, hashPassword } from '../../utils/bcrypt.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { sendEmail } from '../../shared/email/email.service.js';
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from '../../shared/errors/custom.error.js';
import type { LoginInput, RegisterInput, UserSessionResponse } from './auth.types.js';

const verificationCodes = new Map<string, { code: string; expiresAt: number }>();
const recoveryCodes = new Map<string, { code: string; expiresAt: number }>();

export class AuthService {
  private authRepository = new AuthRepository();

  async login(data: LoginInput): Promise<UserSessionResponse> {
    const user = await this.authRepository.findByEmail(data.email);

    if (!user) {
      throw new UnauthorizedError('Credenciales incorrectas.');
    }

    if (!user.password) {
      throw new UnauthorizedError('Debes aceptar la invitación enviada a tu correo antes de iniciar sesión.');
    }

    const isPasswordValid = await comparePassword(data.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Credenciales incorrectas.');
    }

    return this.toSessionResponse(user);
  }

  /**
   * Acepta una invitación al equipo: valida el código enviado por correo,
   * fija la contraseña elegida por el propio invitado y lo deja autenticado
   * (misma respuesta que login/register) para que entre directo a la app.
   */
  async aceptarInvitacion(email: string, token: string, password: string): Promise<UserSessionResponse> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await this.authRepository.findByInvitacionToken(token.trim());

    if (!user || user.email !== cleanEmail) {
      throw new BadRequestError('El código de invitación no es válido para este correo.');
    }
    if (user.invitacionAceptadaEn) {
      throw new BadRequestError('Esta invitación ya fue aceptada. Inicia sesión con tu contraseña.');
    }
    if (!user.invitacionExpiraEn || user.invitacionExpiraEn.getTime() < Date.now()) {
      throw new BadRequestError('La invitación ha expirado. Pide a tu administrador que la reenvíe.');
    }

    const passwordHash = await hashPassword(password);
    const actualizado = await this.authRepository.aceptarInvitacion(user.id, passwordHash);

    return this.toSessionResponse(actualizado);
  }

  private toSessionResponse(user: {
    id: string;
    nombre: string;
    email: string;
    rol: { nombre: string };
    organizacionId: string | null;
    organizacion: { configuracion: unknown } | null;
  }): UserSessionResponse {
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
      organizacionConfigurada: user.organizacion ? user.organizacion.configuracion !== null : false,
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  async sendVerificationCode(email: string): Promise<void> {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Validar que el correo no esté registrado
    const existingUser = await this.authRepository.findByEmail(cleanEmail);
    if (existingUser) {
      throw new ConflictError('El correo electrónico ya está registrado.');
    }

    // 2. Generar código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Expiración en 10 minutos
    const expiresAt = Date.now() + 10 * 60 * 1000;
    verificationCodes.set(cleanEmail, { code, expiresAt });

    await sendEmail({
      to: cleanEmail,
      subject: `${code} es tu código de verificación de Suite Préstamos`,
      devLogFallback: `Código de verificación para ${cleanEmail}: ${code}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #f0f0f0; border-radius: 16px; background-color: #ffffff;">
          <h2 style="color: #059669; font-size: 22px; margin-bottom: 8px;">Verificación de correo electrónico</h2>
          <p style="color: #4b5563; font-size: 15px; line-height: 24px;">Gracias por registrarte en <strong>Suite Préstamos</strong>. Para completar la creación de tu cuenta, ingresa el siguiente código de verificación temporal en la aplicación:</p>
          <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #059669; font-family: monospace;">${code}</span>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 20px;">Este código es temporal y vencerá en <strong>10 minutos</strong>. Si no solicitaste este correo, puedes ignorarlo de forma segura.</p>
          <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 11px; text-align: center;">© ${new Date().getFullYear()} Suite Préstamos. Todos los derechos reservados.</p>
        </div>
      `,
    });
  }

  async sendForgotPasswordCode(email: string): Promise<void> {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Validar que el correo esté registrado
    const existingUser = await this.authRepository.findByEmail(cleanEmail);
    if (!existingUser) {
      throw new BadRequestError('El correo electrónico no está registrado.');
    }

    // 2. Generar código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Expiración en 10 minutos
    const expiresAt = Date.now() + 10 * 60 * 1000;
    recoveryCodes.set(cleanEmail, { code, expiresAt });

    await sendEmail({
      to: cleanEmail,
      subject: `${code} es tu código de recuperación de contraseña de Suite Préstamos`,
      devLogFallback: `Código de recuperación de contraseña para ${cleanEmail}: ${code}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #f0f0f0; border-radius: 16px; background-color: #ffffff;">
          <h2 style="color: #ef4444; font-size: 22px; margin-bottom: 8px;">Recuperación de contraseña</h2>
          <p style="color: #4b5563; font-size: 15px; line-height: 24px;">Has solicitado restablecer la contraseña de tu cuenta en <strong>Suite Préstamos</strong>. Ingresa el siguiente código de verificación en la aplicación:</p>
          <div style="background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 12px; padding: 16px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #ef4444; font-family: monospace;">${code}</span>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 20px;">Este código es temporal y vencerá en <strong>10 minutos</strong>. Si no solicitaste este cambio, puedes ignorar este correo de forma segura y tu contraseña actual no sufrirá cambios.</p>
          <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 11px; text-align: center;">© ${new Date().getFullYear()} Suite Préstamos. Todos los derechos reservados.</p>
        </div>
      `,
    });
  }

  async resetPassword(data: any): Promise<void> {
    const cleanEmail = data.email.trim().toLowerCase();

    // 1. Validar el código de recuperación
    const recovery = recoveryCodes.get(cleanEmail);
    if (!recovery) {
      throw new BadRequestError('No se ha solicitado ningún código de recuperación para este correo.');
    }

    if (Date.now() > recovery.expiresAt) {
      recoveryCodes.delete(cleanEmail);
      throw new BadRequestError('El código de recuperación ha expirado. Solicita uno nuevo.');
    }

    if (recovery.code !== data.code) {
      throw new BadRequestError('El código de recuperación ingresado es incorrecto.');
    }

    // Código válido: eliminar de la caché
    recoveryCodes.delete(cleanEmail);

    const user = await this.authRepository.findByEmail(cleanEmail);
    if (!user) {
      throw new BadRequestError('El usuario no existe.');
    }

    const passwordHash = await hashPassword(data.password);
    await this.authRepository.updatePassword(user.id, passwordHash);
  }

  async register(data: RegisterInput): Promise<UserSessionResponse> {
    const cleanEmail = data.email.trim().toLowerCase();

    // 1. Validar el código de verificación
    const verification = verificationCodes.get(cleanEmail);
    if (!verification) {
      throw new BadRequestError('No se ha solicitado ningún código de verificación para este correo.');
    }

    if (Date.now() > verification.expiresAt) {
      verificationCodes.delete(cleanEmail);
      throw new BadRequestError('El código de verificación ha expirado. Solicita uno nuevo.');
    }

    if (verification.code !== data.code) {
      throw new BadRequestError('El código de verificación ingresado es incorrecto.');
    }

    // Código válido: eliminar de la caché
    verificationCodes.delete(cleanEmail);

    const existingUser = await this.authRepository.findByEmail(cleanEmail);
    if (existingUser) {
      throw new ConflictError('El correo electrónico ya está registrado.');
    }

    // El registro público siempre crea al dueño de una organización nueva como
    // ADMIN. No se acepta el rol desde el cliente para evitar auto-asignación de
    // roles privilegiados.
    const rolNombre = 'ADMIN';
    const rol = await this.authRepository.findRoleByName(rolNombre);
    if (!rol) {
      throw new BadRequestError(`El rol '${rolNombre}' no es válido.`);
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
      // Una organización recién creada aún no tiene configuración.
      organizacionConfigurada: false,
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
      organizacionConfigurada: user.organizacion ? user.organizacion.configuracion !== null : false,
      organizacion: user.organizacion
        ? {
            id: user.organizacion.id,
            nombre: user.organizacion.nombre,
            identificacionTributaria: user.organizacion.identificacionTributaria,
            direccion: user.organizacion.direccion,
            telefono: user.organizacion.telefono,
            configuracion: user.organizacion.configuracion,
          }
        : null,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.password) {
      throw new UnauthorizedError('Usuario no encontrado.');
    }

    const isPasswordValid = await comparePassword(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('La contraseña actual es incorrecta.');
    }

    const passwordHash = await hashPassword(newPassword);
    await this.authRepository.updatePassword(userId, passwordHash);
  }

  async configureOrganization(userId: string, data: any) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedError('Usuario no encontrado.');
    }

    const orgId = user.organizacionId;
    if (!orgId) {
      throw new BadRequestError('El usuario no pertenece a ninguna organización.');
    }

    // Guardar la configuración atómicamente e insertar el equipo
    return prisma.$transaction(async (tx) => {
      // 1. Fusionar la configuración nueva con la existente para que un guardado
      // parcial (p. ej. solo finanzas) no borre las demás claves.
      const orgActual = await tx.organizacion.findUnique({ where: { id: orgId } });
      const configuracion = {
        ...((orgActual?.configuracion as Record<string, unknown>) || {}),
        ...(data.configuracion || {}),
      };

      // Reflejar los datos de empresa también en las columnas propias de la
      // organización (las que usa la sincronización offline).
      const columnas: Record<string, unknown> = {};
      if (configuracion.nombreComercial) columnas.nombre = configuracion.nombreComercial;
      if (configuracion.identificacionTributaria !== undefined) {
        columnas.identificacionTributaria = configuracion.identificacionTributaria;
      }
      if (configuracion.direccion !== undefined) columnas.direccion = configuracion.direccion;
      if (configuracion.telefono !== undefined) columnas.telefono = configuracion.telefono;

      const organizacionActualizada = await tx.organizacion.update({
        where: { id: orgId },
        data: {
          configuracion,
          ...columnas,
        },
      });

      // 2. Si se provee equipo (cobradores/cajeros), crearlos
      if (data.equipo && Array.isArray(data.equipo)) {
        for (const member of data.equipo) {
          const cleanEmail = member.email.trim().toLowerCase();
          
          // Verificar si ya existe el usuario
          const existingUser = await tx.usuario.findUnique({ where: { email: cleanEmail } });
          if (existingUser) continue; // Si ya existe, lo ignoramos

          // Buscar el rol solicitado (validado por el schema); por defecto COBRADOR
          const rolName = member.rol || 'COBRADOR';
          let rol = await tx.rol.findUnique({ where: { nombre: rolName } });
          if (!rol) {
            rol = await tx.rol.create({
              data: {
                nombre: rolName,
                descripcion: `Rol de ${rolName.toLowerCase()}`,
              },
            });
          }

          // Si el admin no fija contraseña, se genera una aleatoria fuerte (nunca
          // una credencial por defecto conocida). Se registra para que el admin
          // pueda comunicársela al miembro.
          let plainPassword = member.password;
          if (!plainPassword) {
            plainPassword = randomBytes(9).toString('base64url');
            logger.warn(
              `🔑 Contraseña temporal generada para ${cleanEmail}: ${plainPassword} (comunícala de forma segura y pide cambiarla).`
            );
          }
          const passwordHash = await hashPassword(plainPassword);

          // Crear miembro del equipo
          await tx.usuario.create({
            data: {
              nombre: member.nombre,
              email: cleanEmail,
              password: passwordHash,
              rolId: rol.id,
              organizacionId: orgId,
            },
          });
        }
      }

      return {
        success: true,
        organizacionId: orgId,
        configuracion: organizacionActualizada.configuracion,
      };
    });
  }
}
