import { describe, it, expect } from 'vitest';
import { pushSchema } from '../sincronizacion.schema.js';

describe('pushSchema', () => {
  it('acepta un payload típico de WatermelonDB con varias tablas', () => {
    const payload = {
      changes: {
        rutas: { created: [{ id: 'r1', nombre: 'Ruta 1' }], updated: [], deleted: [] },
        clientes: { created: [], updated: [{ id: 'c1', nombres: 'Juan' }], deleted: ['c2'] },
        cuotas: { created: [], updated: [], deleted: [] },
      },
    };
    const resultado = pushSchema.parse(payload);
    expect(resultado.changes.rutas.created).toHaveLength(1);
    expect(resultado.changes.clientes.deleted).toEqual(['c2']);
  });

  it('rellena created/updated/deleted con [] si una tabla los omite', () => {
    const payload = { changes: { rutas: {} } };
    const resultado = pushSchema.parse(payload);
    expect(resultado.changes.rutas).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('acepta un objeto de cambios vacío (push sin cambios locales)', () => {
    expect(() => pushSchema.parse({ changes: {} })).not.toThrow();
  });

  it('rechaza si falta `changes`', () => {
    expect(() => pushSchema.parse({})).toThrow();
  });

  it('rechaza si `changes` no es un objeto (payload malformado)', () => {
    expect(() => pushSchema.parse({ changes: 'no-es-un-objeto' })).toThrow();
  });

  it('rechaza si `deleted` no es un arreglo de strings', () => {
    const payload = { changes: { rutas: { created: [], updated: [], deleted: [123] } } };
    expect(() => pushSchema.parse(payload)).toThrow();
  });
});
