import {
  baseInicialImplicita,
  distribuirEnCuotas,
  montoAplicadoDePago,
  TOLERANCIA_CUOTA_PAGADA,
} from '../../modules/pago/redistribucion.js';

/**
 * Detección (sin BD, sin escribir nada) de préstamos descuadrados por los bugs
 * de cobros corregidos en oct 2026: sobrepagos, cuotas pisadas por el sync,
 * cobros duplicados por doble toque, préstamos que nunca se liquidaron, etc.
 * Ver `scripts/diagnosticar-cobros.ts`.
 */

export type Severidad = 'ALTA' | 'MEDIA' | 'BAJA';

export type TipoHallazgo =
  | 'CUOTAS_POR_DEBAJO_DE_PAGOS'
  | 'SOBREPAGO'
  | 'PRESTAMO_TRABADO'
  | 'LIQUIDADO_CON_PENDIENTE'
  | 'CUOTAS_FUERA_DE_ORDEN'
  | 'BASE_INICIAL_SOSPECHOSA'
  | 'POSIBLE_COBRO_DUPLICADO'
  | 'PAGO_EN_CERO'
  | 'CUOTA_PAGADA_CON_FALTANTE';

export interface Hallazgo {
  tipo: TipoHallazgo;
  severidad: Severidad;
  /** RD$ involucrados (para ordenar por impacto); 0 si no aplica. */
  impacto: number;
  detalle: string;
}

export interface CuotaDiag {
  numeroCuota: number;
  montoTotal: number;
  montoPagado: number;
  estado: string;
}

export interface PagoDiag {
  id: string;
  monto: number;
  moraCobrada: number;
  fechaPago: Date;
  jornadaId?: string | null;
  detalleCuotas?: string | null;
}

export interface PrestamoDiag {
  estado: string;
  /** Solo cuotas sin deletedAt. */
  cuotas: CuotaDiag[];
  /** Solo pagos vigentes (sin deletedAt). */
  pagos: PagoDiag[];
}

const CENTAVO = 0.005;
const UMBRAL = 0.99;
/** Dos cobros iguales del mismo préstamo con menos de esto entre sí: doble toque. */
const VENTANA_DUPLICADO_MS = 2 * 60 * 1000;

const rd = (n: number) => `RD$ ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function diagnosticarPrestamo(p: PrestamoDiag): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  if (p.estado === 'CANCELADO') return hallazgos;

  const cuotas = [...p.cuotas].sort((a, b) => a.numeroCuota - b.numeroCuota);
  const pagos = [...p.pagos].sort((a, b) => a.fechaPago.getTime() - b.fechaPago.getTime());
  const pendienteDe = (c: { montoTotal: number; montoPagado: number }) => Math.max(0, c.montoTotal - c.montoPagado);

  // 1. Sobrepagos: el pago guardó más de lo que aplicó a cuotas.
  for (const pg of pagos) {
    const exceso = pg.monto - montoAplicadoDePago(pg);
    if (exceso > UMBRAL) {
      hallazgos.push({
        tipo: 'SOBREPAGO',
        severidad: 'ALTA',
        impacto: exceso,
        detalle: `Pago ${pg.id} del ${pg.fechaPago.toISOString().slice(0, 10)}: monto ${rd(pg.monto)}, solo aplicó ${rd(pg.monto - exceso)} (exceso ${rd(exceso)} cobrado de más al cliente).`,
      });
    }
  }

  // 2. Cuotas vs pagos: base de cuotas pagadas de inicio implícita.
  const { base, sinRecortar } = baseInicialImplicita(cuotas, pagos);
  if (sinRecortar < -UMBRAL) {
    hallazgos.push({
      tipo: 'CUOTAS_POR_DEBAJO_DE_PAGOS',
      severidad: 'ALTA',
      impacto: -sinRecortar,
      detalle: `Las cuotas muestran ${rd(-sinRecortar)} MENOS pagado de lo que suman sus pagos vigentes: el cliente aparece debiendo de más (típico de un borrado de cobro pisado por el sync o de dos cobradores sin señal).`,
    });
  }

  if (base > UMBRAL && cuotas.length > 0) {
    // Una base legítima son N cuotas completas pagadas de inicio.
    let acumulado = 0;
    let calzaConCuotasCompletas = false;
    for (const c of cuotas) {
      acumulado += c.montoTotal;
      if (Math.abs(acumulado - base) <= UMBRAL) {
        calzaConCuotasCompletas = true;
        break;
      }
      if (acumulado > base + UMBRAL) break;
    }
    if (!calzaConCuotasCompletas) {
      hallazgos.push({
        tipo: 'BASE_INICIAL_SOSPECHOSA',
        severidad: 'MEDIA',
        impacto: base,
        detalle: `Hay ${rd(base)} pagados en cuotas que ningún pago justifica y que no equivalen a un número entero de cuotas pagadas de inicio: puede ser dinero fantasma (un dispositivo desactualizado reescribió cuotas) o un abono inicial parcial legítimo. Revisar a mano.`,
      });
    }
  }

  // 3. Reparto: lo que el servidor reconstruiría vs lo que hay hoy.
  const simulado = distribuirEnCuotas(
    cuotas.map((c) => c.montoTotal),
    [base, ...pagos.map((pg) => pg.monto)]
  );
  const pendienteActual = cuotas.reduce((s, c) => s + pendienteDe(c), 0);
  const pendienteSimulado = cuotas.reduce((s, c, i) => s + Math.max(0, c.montoTotal - simulado[i]), 0);
  const cuotasDistintas = cuotas.filter((c, i) => Math.abs(c.montoPagado - simulado[i]) > UMBRAL);
  if (cuotasDistintas.length > 0 && Math.abs(pendienteActual - pendienteSimulado) <= UMBRAL) {
    hallazgos.push({
      tipo: 'CUOTAS_FUERA_DE_ORDEN',
      severidad: 'MEDIA',
      impacto: cuotasDistintas.reduce((s, c) => s + Math.abs(c.montoPagado - simulado[cuotas.indexOf(c)]), 0) / 2,
      detalle: `El saldo total cuadra, pero ${cuotasDistintas.length} cuota(s) tienen el dinero en el lugar equivocado (cuotas: ${cuotasDistintas.map((c) => c.numeroCuota).join(', ')}): puede marcar atraso y mora sobre cuotas que en realidad están cubiertas.`,
    });
  }

  // 4. Estado del préstamo vs cuotas.
  const hayPendiente = cuotas.some((c) => pendienteDe(c) > TOLERANCIA_CUOTA_PAGADA);
  if (cuotas.length > 0 && !hayPendiente && p.estado === 'ACTIVO') {
    hallazgos.push({
      tipo: 'PRESTAMO_TRABADO',
      severidad: 'ALTA',
      impacto: 0,
      detalle: 'Todas las cuotas están pagadas pero el préstamo sigue ACTIVO: aparece como cliente con préstamo vigente y no deja cobrar.',
    });
  }
  if (p.estado === 'LIQUIDADO' && hayPendiente) {
    hallazgos.push({
      tipo: 'LIQUIDADO_CON_PENDIENTE',
      severidad: 'ALTA',
      impacto: pendienteActual,
      detalle: `El préstamo figura LIQUIDADO pero sus cuotas suman ${rd(pendienteActual)} pendientes: no aparece para cobrar.`,
    });
  }

  // 5. Cuotas PAGADA con centavos faltantes (redondeo del monto sugerido).
  const cortas = cuotas.filter((c) => c.estado === 'PAGADA' && pendienteDe(c) > 0.05);
  if (cortas.length > 0) {
    const faltante = cortas.reduce((s, c) => s + pendienteDe(c), 0);
    hallazgos.push({
      tipo: 'CUOTA_PAGADA_CON_FALTANTE',
      severidad: 'BAJA',
      impacto: faltante,
      detalle: `${cortas.length} cuota(s) PAGADA con faltante (total ${rd(faltante)}): redondeo a pesos del monto sugerido.`,
    });
  }

  // 6. Pagos en cero (vaciados por un push que editó el monto).
  for (const pg of pagos) {
    if (Math.abs(pg.monto) < CENTAVO && Math.abs(pg.moraCobrada) < CENTAVO) {
      hallazgos.push({
        tipo: 'PAGO_EN_CERO',
        severidad: 'MEDIA',
        impacto: 0,
        detalle: `Pago ${pg.id} vigente con monto y mora en 0: posible pago "anulado" editándolo en vez de borrarlo.`,
      });
    }
  }

  // 7. Cobros duplicados por doble toque.
  for (let i = 1; i < pagos.length; i++) {
    const a = pagos[i - 1];
    const b = pagos[i];
    if (
      b.monto > 0 &&
      Math.abs(a.monto - b.monto) < CENTAVO &&
      Math.abs(a.moraCobrada - b.moraCobrada) < CENTAVO &&
      (a.jornadaId ?? null) === (b.jornadaId ?? null) &&
      b.fechaPago.getTime() - a.fechaPago.getTime() <= VENTANA_DUPLICADO_MS
    ) {
      hallazgos.push({
        tipo: 'POSIBLE_COBRO_DUPLICADO',
        severidad: 'MEDIA',
        impacto: b.monto + b.moraCobrada,
        detalle: `Pagos ${a.id} y ${b.id}: mismo monto (${rd(b.monto)}) con ${Math.round((b.fechaPago.getTime() - a.fechaPago.getTime()) / 1000)} s de diferencia. Confirmar con el cobrador si se cobró dos veces.`,
      });
    }
  }

  return hallazgos;
}

/**
 * Cuántas cuotas COMPLETAS pagadas de inicio explica la base implícita del
 * préstamo (para sugerir `reparar-prestamos --cuotas-iniciales N`), o null si
 * la base no equivale a un número entero de cuotas (hay que decidirlo a mano).
 */
export function cuotasInicialesImplicitas(p: PrestamoDiag): number | null {
  const cuotas = [...p.cuotas].sort((a, b) => a.numeroCuota - b.numeroCuota);
  const { base } = baseInicialImplicita(cuotas, p.pagos);
  if (base <= UMBRAL) return 0;
  let acumulado = 0;
  for (let i = 0; i < cuotas.length; i++) {
    acumulado += cuotas[i].montoTotal;
    if (Math.abs(acumulado - base) <= UMBRAL) return i + 1;
    if (acumulado > base + UMBRAL) return null;
  }
  return null;
}
