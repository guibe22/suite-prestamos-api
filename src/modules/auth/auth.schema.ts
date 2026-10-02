import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('El correo electrónico no es válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

export const registerSchema = z.object({
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.'),
  email: z.string().email('El correo electrónico no es válido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
  rolNombre: z.string().default('ADMIN'),
  organizacionNombre: z.string().optional(),
  code: z.string().length(6, 'El código de verificación debe tener 6 dígitos.'),
});

export const sendCodeSchema = z.object({
  email: z.string().email('El correo electrónico no es válido.'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'El refresh token es requerido.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es requerida.'),
  newPassword: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres.'),
});

export const configureOrganizationSchema = z.object({
  configuracion: z.record(z.string(), z.any()).optional(),
  equipo: z
    .array(
      z.object({
        nombre: z.string().min(2, 'El nombre del miembro es requerido.'),
        email: z.string().email('El correo del miembro no es válido.'),
        rol: z.enum(['COBRADOR', 'CAJERO', 'GERENTE', 'ADMIN']).optional(),
        password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').optional(),
      })
    )
    .optional(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('El correo electrónico no es válido.'),
  code: z.string().length(6, 'El código de verificación debe tener 6 dígitos.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

export const aceptarInvitacionSchema = z.object({
  email: z.string().email('El correo electrónico no es válido.'),
  token: z.string().min(1, 'El código de invitación es requerido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

/**
 * Confirmación del borrado de cuenta. Admite dos formas porque no todas las
 * cuentas tienen contraseña: las creadas con Google guardan `password: null`
 * (ver googleAuth), y exigirles una las dejaba sin ninguna forma de borrarse
 * desde la app — algo que las tiendas exigen que esté disponible para TODOS
 * los usuarios. Esas confirman escribiendo el correo de su cuenta.
 */
export const eliminarCuentaSchema = z.object({
  password: z.string().min(1).optional(),
  confirmacionEmail: z.string().min(1).optional(),
});
// Cuál de los dos hace falta depende de si la cuenta tiene contraseña, algo
// que solo se sabe consultando al usuario: la regla vive en el servicio
// (eliminarCuenta), no aquí.

export const googleAuthSchema = z.object({
  idToken: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  invitacionToken: z.string().min(1).optional(),
});

