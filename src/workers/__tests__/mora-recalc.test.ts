import { describe, it, expect } from 'vitest';
import { calcularCargoMora } from '../mora-recalc.worker.js';

const hace = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
// El worker calcula el CARGO del período, no el total. Un préstamo que aún no
// ha devengado se pasa con Infinity (díasDesdeUltimoCargo) para que cubra todo
// el atraso acumulado — así la prueba describe el devengo desde el arranque.
const SIN_DEVENGAR = Infinity;
const CONFIG = { tasaMora: '1', diasGracia: '0' };

describe('mora-recalc.worker — calcularCargoMora', () => {
  it('sin cuotas vencidas no hay mora', () => {
    const enUnaSemana = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(
      calcularCargoMora([{ fechaVencimiento: enUnaSemana, montoTotal: 1000, montoPagado: 0 }], CONFIG, SIN_DEVENGAR)
    ).toBe(0);
  });

  it('tasa de mora en 0 desactiva el cálculo completo', () => {
    expect(
      calcularCargoMora([{ fechaVencimiento: hace(30), montoTotal: 1000, montoPagado: 0 }], {
        tasaMora: '0',
        diasGracia: '0',
      }, SIN_DEVENGAR)
    ).toBe(0);
  });

  it('CUOTA (default): saldo × tasa diaria × días de atraso', () => {
    // 1000 × 1% × 10 días = 100
    expect(
      calcularCargoMora([{ fechaVencimiento: hace(10), montoTotal: 1000, montoPagado: 0 }], CONFIG, SIN_DEVENGAR)
    ).toBe(100);
  });

  it('CUOTA: la mora se calcula sobre el saldo, no sobre el monto total', () => {
    // saldo 400 × 1% × 10 días = 40
    expect(
      calcularCargoMora([{ fechaVencimiento: hace(10), montoTotal: 1000, montoPagado: 600 }], CONFIG, SIN_DEVENGAR)
    ).toBe(40);
  });

  it('CUOTA: suma la mora de cada cuota vencida por separado', () => {
    // (1000 × 1% × 10) + (1000 × 1% × 5) = 100 + 50 = 150
    expect(
      calcularCargoMora(
        [
          { fechaVencimiento: hace(10), montoTotal: 1000, montoPagado: 0 },
          { fechaVencimiento: hace(5), montoTotal: 1000, montoPagado: 0 },
        ],
        CONFIG,
        SIN_DEVENGAR
      )
    ).toBe(150);
  });

  it('los días de gracia excluyen la cuota mientras el atraso no los supere', () => {
    const conGracia = { tasaMora: '1', diasGracia: '5' };
    const cuotas = [{ fechaVencimiento: hace(5), montoTotal: 1000, montoPagado: 0 }];
    // 5 días de atraso con 5 de gracia: aún no genera mora (la condición es > gracia)
    expect(calcularCargoMora(cuotas, conGracia, SIN_DEVENGAR)).toBe(0);
    // Al sexto día ya cuenta, y cuenta los 6 días completos: 1000 × 1% × 6 = 60
    expect(
      calcularCargoMora([{ fechaVencimiento: hace(6), montoTotal: 1000, montoPagado: 0 }], conGracia, SIN_DEVENGAR)
    ).toBe(60);
  });

  it('PRESTAMO_TOTAL: saldo vencido completo × tasa × días de la cuota más atrasada', () => {
    // (1000 + 1000) × 1% × 10 = 200 (usa el atraso máximo, no el de cada cuota)
    expect(
      calcularCargoMora(
        [
          { fechaVencimiento: hace(10), montoTotal: 1000, montoPagado: 0 },
          { fechaVencimiento: hace(5), montoTotal: 1000, montoPagado: 0 },
        ],
        { tasaMora: '1', diasGracia: '0', tipoCalculoMora: 'PRESTAMO_TOTAL' },
        SIN_DEVENGAR
      )
    ).toBe(200);
  });

  it('PRESTAMO_TOTAL sin saldo vencido devuelve 0 aunque haya cuotas vencidas saldadas', () => {
    expect(
      calcularCargoMora(
        [{ fechaVencimiento: hace(10), montoTotal: 1000, montoPagado: 1000 }],
        { tasaMora: '1', diasGracia: '0', tipoCalculoMora: 'PRESTAMO_TOTAL' },
        SIN_DEVENGAR
      )
    ).toBe(0);
  });

  it('devengo incremental: cubre solo los días transcurridos desde el último cargo', () => {
    // El worker corrió ayer y le devengó 1 día; hoy suma un día más (no todo el
    // atraso): 1000 × 1% × 1 = 10.
    expect(
      calcularCargoMora(
        [{ fechaVencimiento: hace(10), montoTotal: 1000, montoPagado: 0 }],
        CONFIG,
        1
      )
    ).toBe(10);
  });
});