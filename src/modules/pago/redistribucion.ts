/**
 * Reparto puro (sin BD) de dinero sobre las cuotas de un préstamo. Lo usan
 * `PagoService.redistribuirCuotas` y el script de diagnóstico
 * (`scripts/diagnosticar-cobros.ts`), para que el diagnóstico prediga
 * EXACTAMENTE lo que haría el servidor.
 */

/** Pendiente por debajo del cual una cuota se da por cubierta al repartir. */
const TOLERANCIA_CUBIERTA = 0.05;
/** Residuo menor a esto se absorbe en la cuota actual (centavos de división). */
const TOLERANCIA_RESIDUO = 0.99;
/** Pendiente hasta el cual una cuota se marca PAGADA (igual que la app). */
export const TOLERANCIA_CUOTA_PAGADA = 0.99;

/**
 * Monto que un pago aplicó de verdad a cuotas. Un pago con sobrepago (antes
 * de que la app lo bloqueara) guardaba en `monto` más de lo que aplicó; el
 * excedente no está en ninguna cuota, así que restar `monto` completo al
 * deducir la base de cuotas pagadas de inicio la achicaba para siempre (el
 * cliente terminaba debiendo más). `detalleCuotas` registra lo aplicado.
 */
export function montoAplicadoDePago(pago: { monto?: unknown; detalleCuotas?: string | null }): number {
  const monto = Number(pago?.monto || 0);
  if (!pago?.detalleCuotas) return monto;
  try {
    const detalle = JSON.parse(pago.detalleCuotas);
    if (!Array.isArray(detalle) || detalle.length === 0) return monto;
    const aplicado = detalle.reduce((sum: number, d: { monto?: unknown }) => sum + (Number(d?.monto) || 0), 0);
    return Math.min(monto, aplicado);
  } catch {
    return monto;
  }
}

/**
 * Base de cuotas pagadas de inicio deducida de un estado de cuotas: lo pagado
 * en cuotas menos lo aplicado por los pagos que ese estado refleja, recortado a
 * [0, Σ montoTotal]. `sinRecortar` sirve al diagnóstico: un valor negativo
 * significa que las cuotas muestran MENOS pagado de lo que justifican los pagos.
 */
export function baseInicialImplicita(
  cuotas: { montoTotal?: unknown; montoPagado?: unknown }[],
  pagos: { monto?: unknown; detalleCuotas?: string | null }[]
): { base: number; sinRecortar: number } {
  const totalCuotas = cuotas.reduce((sum, c) => sum + Number(c.montoTotal || 0), 0);
  const totalPagadoCuotas = cuotas.reduce((sum, c) => sum + Number(c.montoPagado || 0), 0);
  const totalAplicado = pagos.reduce((sum, p) => sum + montoAplicadoDePago(p), 0);
  const sinRecortar = totalPagadoCuotas - totalAplicado;
  return { base: Math.min(totalCuotas, Math.max(0, sinRecortar)), sinRecortar };
}

/**
 * Reparte `aportes` (primero la base inicial, luego cada pago en orden
 * cronológico) sobre cuotas ordenadas por número, de la más antigua a la más
 * nueva. Devuelve el `montoPagado` resultante de cada cuota. El excedente que
 * no cabe al acabarse las cuotas se descarta.
 */
export function distribuirEnCuotas(montosTotales: number[], aportes: number[]): number[] {
  const pagado = montosTotales.map(() => 0);
  let i = 0;
  for (const aporte of aportes) {
    let restante = Math.max(0, aporte);
    while (restante > 0 && i < montosTotales.length) {
      const pendiente = montosTotales[i] - pagado[i];
      if (pendiente <= TOLERANCIA_CUBIERTA) {
        i++;
        continue;
      }
      const parte = Math.min(restante, pendiente);
      pagado[i] += parte;
      restante -= parte;
      if (restante > 0 && restante < TOLERANCIA_RESIDUO) {
        pagado[i] += restante;
        restante = 0;
      }
      if (montosTotales[i] - pagado[i] <= TOLERANCIA_CUBIERTA) {
        i++;
      }
    }
  }
  return pagado;
}
