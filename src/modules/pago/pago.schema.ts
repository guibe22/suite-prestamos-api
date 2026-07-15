import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid('El id no es válido.'),
});
