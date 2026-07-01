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
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'El refresh token es requerido.'),
});
