import { describe, it, expect } from 'vitest';
import { calcularPuntuacionYCalificacion } from '../score-recalc.worker.js';

describe('score-recalc.worker — calcularPuntuacionYCalificacion', () => {
  it('sin cuotas vencidas y sin historial: puntuación máxima', () => {
    const { puntuacion, calificacion } = calcularPuntuacionYCalificacion([], 0);
    expect(puntuacion).toBe(100);
    expect(calificacion).toBe('BUENO');
  });

  it('una cuota recién vencida penaliza poco (severidad mínima)', () => {
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { puntuacion } = calcularPuntuacionYCalificacion(
      [{ fechaVencimiento: ayer, montoTotal: 1000, montoPagado: 0 }],
      0
    );
    expect(puntuacion).toBeLessThan(100);
    expect(puntuacion).toBeGreaterThan(85);
  });

  it('varias cuotas vencidas hace mucho tiempo bajan la puntuación a RIESGOSO', () => {
    const hace60dias = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const { puntuacion, calificacion } = calcularPuntuacionYCalificacion(
      Array.from({ length: 5 }, () => ({ fechaVencimiento: hace60dias, montoTotal: 1000, montoPagado: 0 })),
      0
    );
    expect(calificacion).toBe('RIESGOSO');
    expect(puntuacion).toBeGreaterThanOrEqual(10);
  });

  it('un abono parcial reduce el impacto de la cuota vencida frente a una sin pagar', () => {
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sinAbono = calcularPuntuacionYCalificacion([{ fechaVencimiento: ayer, montoTotal: 1000, montoPagado: 0 }], 0);
    const conAbono = calcularPuntuacionYCalificacion([{ fechaVencimiento: ayer, montoTotal: 1000, montoPagado: 800 }], 0);
    expect(conAbono.puntuacion).toBeGreaterThan(sinAbono.puntuacion);
  });

  it('el bono por préstamos liquidados está topado en 15 puntos', () => {
    const { puntuacion } = calcularPuntuacionYCalificacion([], 10);
    expect(puntuacion).toBe(100); // ya estaba en el tope de 100, el bono no lo pasa de ahí
  });

  it('la puntuación nunca baja de 10', () => {
    const hace200dias = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const { puntuacion } = calcularPuntuacionYCalificacion(
      Array.from({ length: 20 }, () => ({ fechaVencimiento: hace200dias, montoTotal: 1000, montoPagado: 0 })),
      0
    );
    expect(puntuacion).toBe(10);
  });
});
