import { describe, expect, it } from 'vitest';
import { diagnosticarPrestamo, type CuotaDiag, type PagoDiag } from '../lib/diagnostico-cobros.js';

const cuotas = (pagados: number[], total = 100): CuotaDiag[] =>
  pagados.map((pagado, i) => ({
    numeroCuota: i + 1,
    montoTotal: total,
    montoPagado: pagado,
    estado: total - pagado <= 0.99 ? 'PAGADA' : 'PENDIENTE',
  }));
const pago = (id: string, monto: number, minuto: number, extra: Partial<PagoDiag> = {}): PagoDiag => ({
  id,
  monto,
  moraCobrada: 0,
  fechaPago: new Date(2026, 9, 1, 8, minuto),
  jornadaId: 'j1',
  ...extra,
});
const tipos = (h: { tipo: string }[]) => h.map((x) => x.tipo).sort();

describe('diagnosticarPrestamo', () => {
  it('un préstamo sano no reporta nada', () => {
    const h = diagnosticarPrestamo({
      estado: 'ACTIVO',
      cuotas: cuotas([100, 100, 0, 0]),
      pagos: [pago('a', 100, 0), pago('b', 100, 60 * 24)],
    });
    expect(h).toEqual([]);
  });

  it('cuotas pisadas por el sync: muestran menos pagado que los pagos', () => {
    // P2 (100) vigente pero c1 y c2 en 0.
    const h = diagnosticarPrestamo({ estado: 'ACTIVO', cuotas: cuotas([0, 0, 0]), pagos: [pago('P2', 100, 0)] });
    expect(tipos(h)).toContain('CUOTAS_POR_DEBAJO_DE_PAGOS');
    expect(h.find((x) => x.tipo === 'CUOTAS_POR_DEBAJO_DE_PAGOS')?.impacto).toBe(100);
  });

  it('sobrepago: monto mayor a lo aplicado según detalleCuotas', () => {
    const h = diagnosticarPrestamo({
      estado: 'LIQUIDADO',
      cuotas: cuotas([100, 100]),
      pagos: [pago('X', 300, 0, { detalleCuotas: JSON.stringify([{ monto: 100 }, { monto: 100 }]) })],
    });
    expect(tipos(h)).toEqual(['SOBREPAGO']);
    expect(h[0].impacto).toBe(100);
  });

  it('préstamo trabado: todas las cuotas pagadas pero ACTIVO', () => {
    const h = diagnosticarPrestamo({ estado: 'ACTIVO', cuotas: cuotas([100, 100]), pagos: [pago('a', 200, 0)] });
    expect(tipos(h)).toEqual(['PRESTAMO_TRABADO']);
  });

  it('LIQUIDADO con cuotas pendientes', () => {
    const h = diagnosticarPrestamo({ estado: 'LIQUIDADO', cuotas: cuotas([100, 0]), pagos: [pago('a', 100, 0)] });
    expect(tipos(h)).toEqual(['LIQUIDADO_CON_PENDIENTE']);
  });

  it('cuotas iniciales legítimas (N cuotas completas) no son sospechosas', () => {
    const h = diagnosticarPrestamo({ estado: 'ACTIVO', cuotas: cuotas([100, 100, 100, 0]), pagos: [pago('a', 100, 0)] });
    expect(h).toEqual([]);
  });

  it('dinero fantasma que no calza con cuotas completas', () => {
    const h = diagnosticarPrestamo({ estado: 'ACTIVO', cuotas: cuotas([100, 50, 0]), pagos: [] });
    expect(tipos(h)).toEqual(['BASE_INICIAL_SOSPECHOSA']);
  });

  it('dinero en la cuota equivocada aunque el total cuadre', () => {
    const h = diagnosticarPrestamo({ estado: 'ACTIVO', cuotas: cuotas([0, 100, 0]), pagos: [pago('a', 100, 0)] });
    expect(tipos(h)).toEqual(['CUOTAS_FUERA_DE_ORDEN']);
  });

  it('doble toque: dos cobros iguales con segundos de diferencia', () => {
    const h = diagnosticarPrestamo({
      estado: 'ACTIVO',
      cuotas: cuotas([100, 100, 0]),
      pagos: [pago('a', 100, 0), { ...pago('b', 100, 0), fechaPago: new Date(2026, 9, 1, 8, 0, 3) }],
    });
    expect(tipos(h)).toEqual(['POSIBLE_COBRO_DUPLICADO']);
  });

  it('cuotas PAGADA con centavos faltantes por redondeo', () => {
    const c = cuotas([133, 133, 0], 133.33);
    const h = diagnosticarPrestamo({ estado: 'ACTIVO', cuotas: c, pagos: [pago('a', 133, 0), pago('b', 133, 60 * 24)] });
    expect(tipos(h)).toContain('CUOTA_PAGADA_CON_FALTANTE');
  });

  it('ignora préstamos CANCELADO', () => {
    expect(diagnosticarPrestamo({ estado: 'CANCELADO', cuotas: cuotas([0]), pagos: [pago('a', 100, 0)] })).toEqual([]);
  });
});
