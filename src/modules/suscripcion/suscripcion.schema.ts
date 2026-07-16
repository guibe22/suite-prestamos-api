import { z } from 'zod';

export const iniciarPaypalSchema = z.object({
  planId: z.string().uuid('El id del plan no es válido.'),
  // El cliente (web) conoce su propia URL de retorno; el backend no asume
  // un dominio fijo.
  returnUrl: z.string().url('returnUrl debe ser una URL válida.'),
  cancelUrl: z.string().url('cancelUrl debe ser una URL válida.'),
});

export const verificarCompraGoogleSchema = z.object({
  purchaseToken: z.string().min(1, 'El purchaseToken es requerido.'),
  productId: z.string().min(1, 'El productId es requerido.'),
});
