import { z } from 'zod';

export const crearUsuarioSchema = z.object({
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.'),
  email: z.string().email('El correo electrónico no es válido.'),
  rol: z.enum(['COBRADOR', 'CAJERO']),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').optional(),
});

export const actualizarUsuarioSchema = z.object({
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.').optional(),
  rol: z.enum(['COBRADOR', 'CAJERO']).optional(),
  activo: z.boolean().optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid('El id no es válido.'),
});
