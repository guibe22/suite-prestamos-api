import { z } from 'zod';

export const crearUsuarioSchema = z.object({
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.'),
  email: z.string().email('El correo electrónico no es válido.'),
  rol: z.enum(['COBRADOR', 'CAJERO']),
});

export const actualizarUsuarioSchema = z.object({
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.').optional(),
  rol: z.enum(['COBRADOR', 'CAJERO']).optional(),
  activo: z.boolean().optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid('El id no es válido.'),
});
