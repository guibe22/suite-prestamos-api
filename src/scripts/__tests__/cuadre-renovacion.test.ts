import { describe, expect, it } from 'vitest';
import {
  cajaEsperada,
  descuadre,
  finDeJornada,
  reengancheMejoraElCuadre,
} from '../lib/cuadre-renovacion.js';

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const apertura = new Date('2026-07-30T08:00:00.000Z');

describe('finDeJornada', () => {
  it('en una jornada CERRADA la ventana termina en el cierre (updatedAt)', () => {
    const cierre = new Date('2026-07-30T17:30:00.000Z');
    expect(finDeJornada({ estado: 'CERRADA', createdAt: apertura, updatedAt: cierre })).toEqual(cierre);
  });

  it('en una jornada ABIERTA la ventana cubre el día completo desde la apertura', () => {
    expect(finDeJornada({ estado: 'ABIERTA', createdAt: apertura, updatedAt: apertura })).toEqual(
      new Date(apertura.getTime() + UN_DIA_MS)
    );
  });

  it('si una jornada CERRADA no tiene updatedAt posterior, cae al día completo', () => {
    expect(finDeJornada({ estado: 'CERRADA', createdAt: apertura, updatedAt: apertura })).toEqual(
      new Date(apertura.getTime() + UN_DIA_MS)
    );
  });
});

describe('descuadre', () => {
  const totales = { saldoInicial: 30000, cobrado: 0, gastos: 0, prestamos: 20000 };

  it('es null mientras no hay efectivo contado', () => {
    expect(descuadre(null, totales)).toBeNull();
  });

  it('marca el sobrante fantasma del bug de renovación', () => {
    // El cobrador entregó 15.000 (20.000 menos los 5.000 que saldó), así que
    // tiene 15.000 en la mano, pero el cuadre solo espera 10.000.
    expect(cajaEsperada(totales)).toBe(10000);
    expect(descuadre(15000, totales)).toBe(5000);
  });

  it('cuadra en cero cuando el saldo saldado cuenta como cobrado', () => {
    expect(descuadre(15000, { ...totales, cobrado: 5000 })).toBe(0);
  });
});

describe('reengancheMejoraElCuadre', () => {
  it('acepta cuando el sobrante es exactamente el saldo saldado', () => {
    expect(reengancheMejoraElCuadre(5000, 5000)).toBe(true);
  });

  it('acepta cuando reduce el sobrante sin pasarse', () => {
    expect(reengancheMejoraElCuadre(8000, 5000)).toBe(true);
  });

  it('acepta un exceso que igual acerca el descuadre a cero', () => {
    // Sobraban 6.000 y el saldo saldado es 11.000: queda un faltante de 5.000,
    // más cerca de cero que el sobrante original.
    expect(reengancheMejoraElCuadre(6000, 11000)).toBe(true);
  });

  it('rechaza cuando el saldo se pasa y empeora el descuadre', () => {
    // Sobraban 1.000: sumar 5.000 al cobrado deja un faltante de 4.000.
    expect(reengancheMejoraElCuadre(1000, 5000)).toBe(false);
  });

  it('rechaza cuando ya faltaba efectivo (sumar cobrado agranda el faltante)', () => {
    expect(reengancheMejoraElCuadre(-2000, 5000)).toBe(false);
  });

  it('rechaza cuando el cuadre ya estaba perfecto', () => {
    expect(reengancheMejoraElCuadre(0, 5000)).toBe(false);
  });

  it('acepta si la jornada todavía no tiene efectivo contado', () => {
    expect(reengancheMejoraElCuadre(null, 5000)).toBe(true);
  });
});
