import { z } from 'zod';

// Los clientes nacen en la app con ids de WatermelonDB (no uuid).
export const clienteIdParamSchema = z.object({
  clienteId: z.string().min(1, 'El id del cliente es obligatorio.').max(64),
});

export const guardarFotoCedulaSchema = z.object({
  // Base64 puro, sin el prefijo data:. El límite real (bytes decodificados)
  // lo aplica el servicio; este solo corta cuerpos absurdos antes de decodificar.
  imagenBase64: z
    .string()
    .min(100, 'La imagen está vacía.')
    .max(700_000, 'La imagen es demasiado grande.')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'La imagen no es base64 válido.'),
});
