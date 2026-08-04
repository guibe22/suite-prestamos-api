/**
 * Aritmética del cuadre de jornada usada por `reparar-cuadres-renovacion.ts`.
 *
 * Vive aparte del script para poder probarla sin base de datos: el script hace
 * `process.exit` al importarse si falta DATABASE_URL, y lo delicado aquí no es
 * la consulta sino el criterio que decide si tocar un cuadre histórico.
 */

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** Igual que TOLERANCIA_LIQUIDACION en la app: medio peso no es un descuadre. */
export const TOLERANCIA = 0.5;

export interface VentanaJornada {
  estado: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fin de la ventana de una jornada, para decidir qué movimientos le pertenecen.
 * En una jornada CERRADA, `updatedAt` es el momento del cierre (el equivalente
 * al `closedAt` que usa la app); mientras sigue ABIERTA se toma el día completo
 * desde su apertura.
 */
export function finDeJornada(jornada: VentanaJornada): Date {
  return jornada.estado === 'CERRADA' && jornada.updatedAt > jornada.createdAt
    ? jornada.updatedAt
    : new Date(jornada.createdAt.getTime() + UN_DIA_MS);
}

export interface TotalesCuadre {
  saldoInicial: number;
  cobrado: number;
  gastos: number;
  prestamos: number;
}

/** Efectivo que el cobrador debería tener en la mano al cerrar. */
export function cajaEsperada(t: TotalesCuadre): number {
  return t.saldoInicial + t.cobrado - t.gastos - t.prestamos;
}

/**
 * Descuadre: positivo = sobra efectivo respecto a lo esperado, negativo = falta.
 * `null` cuando la jornada todavía no tiene efectivo contado.
 */
export function descuadre(saldoFinal: number | null, totales: TotalesCuadre): number | null {
  if (saldoFinal == null) return null;
  return saldoFinal - cajaEsperada(totales);
}

/**
 * ¿Reenganchar un pago de saldado de `monto` acerca el descuadre a cero?
 *
 * Es el criterio de seguridad del script: contar ese saldo como cobrado sube la
 * caja esperada, así que solo corrige jornadas donde efectivamente sobraba
 * efectivo. Si en esa renovación el saldo no se compensó contra el desembolso
 * (interruptor "Descontar saldo anterior de la caja" apagado, dato que nunca se
 * persistió), el cuadre empeoraría y el pago se deja como está.
 *
 * Sin efectivo contado (`null`) no hay evidencia contra la que validar: se
 * acepta, porque es el comportamiento por defecto del flujo de renovación.
 */
export function reengancheMejoraElCuadre(diferenciaAntes: number | null, monto: number): boolean {
  if (diferenciaAntes == null) return true;
  return Math.abs(diferenciaAntes - monto) <= Math.abs(diferenciaAntes);
}
