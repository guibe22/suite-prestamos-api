import { z } from 'zod';

/**
 * Validación laxa a propósito: no se tipa cada tabla/columna de WatermelonDB
 * (frágil y hay 12+ tablas) — solo la forma general que el service espera
 * (`changes[tabla].{created,updated,deleted}`), para que un payload malformado
 * falle con un 400 claro aquí en el borde, en vez de un error profundo y
 * confuso dentro de la transacción de `push()`.
 */
const cambiosTablaSchema = z.object({
  created: z.array(z.record(z.unknown())).default([]),
  updated: z.array(z.record(z.unknown())).default([]),
  deleted: z.array(z.string()).default([]),
});

export const pushSchema = z.object({
  changes: z.record(cambiosTablaSchema),
});
