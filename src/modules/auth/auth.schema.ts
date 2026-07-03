import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('El correo electrónico no es válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

export const registerSchema = z.object({
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.'),
  email: z.string().email('El correo electrónico no es válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
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
  newPassword: z.string().min(6, 'La nueva contraseña debe tener al menos 6 caracteres.'),
});
