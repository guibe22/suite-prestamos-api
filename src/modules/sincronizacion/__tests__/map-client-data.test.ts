import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/database.js', () => ({ prisma: {} }));

const { SincronizacionService } = await import('../sincronizacion.service.js');

// mapClientDataToPrisma y sanitizeForPrisma son `private`: se acceden vía
// `as any` igual que en scope-multi-tenant.test.ts, porque son la superficie
// exacta que traduce el payload de WatermelonDB al input de Prisma.
const service = new SincronizacionService() as any;

describe('SincronizacionService — mapClientDataToPrisma', () => {
  it('renombra created_at/updated_at y los convierte a Date', () => {
    const ts = 1_700_000_000_000;
    const out = service.mapClientDataToPrisma({ id: 'p1', created_at: ts, updated_at: ts });
    expect(out.created_at).toBeUndefined();
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.updatedAt).toBeInstanceOf(Date);
    expect(out.createdAt.getTime()).toBe(ts);
  });

  it('descarta los campos internos de WatermelonDB', () => {
    const out = service.mapClientDataToPrisma({ id: 'p1', _status: 'updated', _changed: 'monto' });
    expect(out._status).toBeUndefined();
    expect(out._changed).toBeUndefined();
  });

  it('convierte moraFechaCalculo a Date (columna DateTime en Prisma)', () => {
    // El pull la manda como timestamp en ms y WatermelonDB reenvía el registro
    // COMPLETO al actualizar un préstamo (al descontar la mora cobrada), así
    // que sin la conversión Prisma recibiría un number y reventaría el push.
    const ts = 1_700_000_000_000;
    const out = service.mapClientDataToPrisma({ id: 'p1', moraAcumulada: 250, moraFechaCalculo: ts });
    expect(out.moraFechaCalculo).toBeInstanceOf(Date);
    expect(out.moraFechaCalculo.getTime()).toBe(ts);
    // moraAcumulada es Decimal, no fecha: se deja tal cual.
    expect(out.moraAcumulada).toBe(250);
  });

  it('deja moraFechaCalculo nula si el préstamo nunca fue calculado', () => {
    const out = service.mapClientDataToPrisma({ id: 'p1', moraFechaCalculo: null });
    expect(out.moraFechaCalculo).toBeNull();
  });
});

describe('SincronizacionService — sanitizeForPrisma (prestamos)', () => {
  it('coalesce moraAcumulada nula a 0 (columna NOT NULL en Prisma)', () => {
    expect(service.sanitizeForPrisma('prestamos', { id: 'p1' }).moraAcumulada).toBe(0);
    expect(service.sanitizeForPrisma('prestamos', { id: 'p1', moraAcumulada: null }).moraAcumulada).toBe(0);
  });

  it('respeta un valor de mora existente', () => {
    expect(service.sanitizeForPrisma('prestamos', { id: 'p1', moraAcumulada: 350 }).moraAcumulada).toBe(350);
  });
});
