import { AuthRepository } from './auth.repository.js';
import { prisma } from '../../config/database.js';
import { comparePassword, hashPassword } from '../../utils/bcrypt.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from '../../shared/errors/custom.error.js';
import type { LoginInput, RegisterInput, UserSessionResponse } from './auth.types.js';

const verificationCodes = new Map<string, { code: string; expiresAt: number }>();

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

    // 3. Enviar correo usando la API de Resend vía HTTP fetch nativo
    const apiKey = process.env.RESEND_API_KEY || 're_fkAXhFsq_PKyGAM6xLRhXcahzpvJjzcZC';

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: 'Suite Préstamos <onboarding@resend.dev>',
          to: cleanEmail,
          subject: `${code} es tu código de verificación de Suite Préstamos`,
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
        }),
      });

      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({}))) as any;
        console.error('Error de la API de Resend:', errJson);
        throw new Error(errJson.message || `Error del servidor de correos (${response.status})`);
      }
    } catch (error: any) {
      console.error('Fallo al enviar correo con Resend:', error);
      throw new Error(`No se pudo enviar el correo de verificación: ${error.message}`);
    }
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

          // Buscar el rol
          const rolName = member.rol === 'COBRADOR' ? 'COBRADOR' : 'COBRADOR';
          let rol = await tx.rol.findUnique({ where: { nombre: rolName } });
          if (!rol) {
            rol = await tx.rol.create({
              data: {
                nombre: rolName,
                descripcion: `Rol de ${rolName.toLowerCase()}`,
              },
            });
          }

          const passwordHash = await hashPassword(member.password || 'Temp12345!');

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
