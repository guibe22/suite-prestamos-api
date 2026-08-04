import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';

const UN_DIA_MS = 86_400_000;

interface CuotaMora {
  fechaVencimiento: Date;
  montoTotal: number;
  montoPagado: number;
}

interface FinanzasMora {
  tasaMora: string;
  diasGracia: string;
  tipoCalculoMora?: string;
}

const aMedianoche = (fecha: Date): number => {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Calcula el CARGO de mora a AGREGAR a `Prestamo.moraAcumulada`, no el total.
 *
 * La mora se devenga por día: el 1% de una cuota de RD$ 500 son RD$ 5, y cada
 * día que pasa sin pagar se le suman esos RD$ 5 a lo que ya venía acumulado.
 * El worker nunca sobreescribe el saldo de mora — solo suma el cargo del
 * período — para que un ajuste manual del Admin, una exoneración o una mora ya
 * cobrada no se deshagan solas de un día para otro.
 *
 * `diasDesdeUltimoCargo` es cuántos días pasaron desde la última vez que se le
 * devengó mora a este préstamo (`moraFechaCalculo`). Normalmente 1; más si el
 * worker no corrió algunos días. Para un préstamo que nunca devengó se pasa
 * `Infinity`: ahí el cargo cubre todo el atraso acumulado hasta hoy, que es
 * exactamente lo que calcula `calcularMoraDePrestamo` en la app
 * (suite-prestamos-app/src/utils/documentos.ts) — de modo que el arranque del
 * devengo coincide con lo que el cobrador ya veía en pantalla.
 *
 * No hay paquete compartido entre la app y la API: si la fórmula cambia en la
 * app, hay que replicar el cambio aquí. Corre server-side para que la mora se
 * siga devengando aunque ningún dispositivo haga sync durante días.
 */
function calcularCargoMora(
  cuotas: CuotaMora[],
  finanzas: FinanzasMora,
  diasDesdeUltimoCargo: number
): number {
  const tasaMoraDiaria = parseFloat(finanzas.tasaMora) || 0;
  const diasGracia = parseInt(finanzas.diasGracia) || 0;
  if (tasaMoraDiaria <= 0) return 0;
  if (diasDesdeUltimoCargo <= 0) return 0;

  const tipoCalculo =
    finanzas.tipoCalculoMora === 'PRESTAMO_TOTAL' ? 'PRESTAMO_TOTAL' : 'CUOTA';

  const hoyTs = aMedianoche(new Date());

  if (tipoCalculo === 'PRESTAMO_TOTAL') {
    let saldoTotalVencido = 0;
    let diasAtrasoMax = 0;

    for (const cuota of cuotas) {
      const vencimientoTs = aMedianoche(cuota.fechaVencimiento);
      if (hoyTs <= vencimientoTs) continue;
      const diasAtraso = Math.floor((hoyTs - vencimientoTs) / UN_DIA_MS);
      if (diasAtraso <= diasGracia) continue;
      saldoTotalVencido += Math.max(0, cuota.montoTotal - cuota.montoPagado);
      diasAtrasoMax = Math.max(diasAtrasoMax, diasAtraso);
    }

    if (saldoTotalVencido <= 0) return 0;
    // Se cobran los días transcurridos, topados por el atraso real: si el
    // préstamo cayó en mora hace 2 días pero el worker no corría desde hace 10,
    // solo se devengan 2.
    const diasACobrar = Math.min(diasDesdeUltimoCargo, diasAtrasoMax);
    return Math.round(saldoTotalVencido * (tasaMoraDiaria / 100) * diasACobrar);
  }

  let cargo = 0;
  for (const cuota of cuotas) {
    const vencimientoTs = aMedianoche(cuota.fechaVencimiento);
    if (hoyTs <= vencimientoTs) continue;
    const diasAtraso = Math.floor((hoyTs - vencimientoTs) / UN_DIA_MS);
    if (diasAtraso <= diasGracia) continue;

    const saldoCuota = Math.max(0, cuota.montoTotal - cuota.montoPagado);
    if (saldoCuota <= 0) continue;

    const diasACobrar = Math.min(diasDesdeUltimoCargo, diasAtraso);
    cargo += saldoCuota * (tasaMoraDiaria / 100) * diasACobrar;
  }
  return Math.round(cargo);
}

/**
 * Cuántos días de mora hay que devengarle a un préstamo hoy.
 * `null` en moraFechaCalculo = nunca devengó → se cubre todo el atraso.
 * 0 días = ya se le devengó hoy (el worker corrió dos veces, o la app tocó la
 * mora hoy al cobrar/ajustar) → no se cobra dos veces el mismo día.
 */
function diasPendientesDeDevengo(moraFechaCalculo: Date | null): number {
  if (!moraFechaCalculo) return Infinity;
  const hoyTs = aMedianoche(new Date());
  const ultimoTs = aMedianoche(moraFechaCalculo);
  return Math.max(0, Math.floor((hoyTs - ultimoTs) / UN_DIA_MS));
}

async function recalcularMoraOrganizacion(): Promise<void> {
  // Cargar todos los préstamos ACTIVOS con sus cuotas PENDIENTE y la config
  // de la organización en una sola consulta (evita N+1).
  const prestamos = await prisma.prestamo.findMany({
    where: { estado: 'ACTIVO', deletedAt: null },
    select: {
      id: true,
      moraAcumulada: true,
      moraFechaCalculo: true,
      cliente: {
        select: {
          organizacion: {
            select: { configuracion: true },
          },
        },
      },
      cuotas: {
        where: { estado: 'PENDIENTE', deletedAt: null },
        select: { fechaVencimiento: true, montoTotal: true, montoPagado: true },
      },
    },
  });

  let actualizados = 0;
  let cargoTotal = 0;
  const ahora = new Date();

  for (const prestamo of prestamos) {
    const configuracion = prestamo.cliente?.organizacion?.configuracion as any;
    const finanzas = configuracion?.finanzas;
    if (!finanzas?.tasaMora) continue;

    const dias = diasPendientesDeDevengo(prestamo.moraFechaCalculo);
    if (dias <= 0) continue;

    const cargo = calcularCargoMora(
      prestamo.cuotas.map((c) => ({
        fechaVencimiento: c.fechaVencimiento,
        montoTotal: Number(c.montoTotal),
        montoPagado: Number(c.montoPagado),
      })),
      finanzas,
      dias
    );

    // Sin cargo no se escribe nada: ni el saldo de mora ni la fecha. Así un
    // préstamo al día conserva su `moraFechaCalculo` nula y la app puede seguir
    // usando su cálculo al vuelo hasta que exista mora real (ver
    // getMoraEfectiva en suite-prestamos-app/src/services/mora.service.ts).
    if (cargo <= 0) continue;

    await prisma.prestamo.update({
      where: { id: prestamo.id },
      data: {
        // Suma, no reemplazo: el saldo de mora es un acumulado que solo baja
        // al cobrarse o al ajustarlo el Admin.
        moraAcumulada: { increment: cargo },
        moraFechaCalculo: ahora,
      },
    });
    actualizados++;
    cargoTotal += cargo;
  }

  logger.info(
    `⏰ [mora-recalc] ${actualizados}/${prestamos.length} préstamos devengaron mora (cargo total ${cargoTotal}).`
  );
}

export const startMoraRecalcWorker = (): void => {
  // 3:30 AM todos los días — media hora después del score-recalc, para no
  // competir por conexiones de base de datos.
  cron.schedule('30 3 * * *', () => {
    recalcularMoraOrganizacion().catch((e) =>
      logger.error(e, '💥 Error en mora-recalc.worker')
    );
  });
  logger.info('⚙️  Mora Recalc Worker programado (diario 3:30 AM).');
};

// Exportado solo para pruebas y llamadas manuales.
export { recalcularMoraOrganizacion, calcularCargoMora, diasPendientesDeDevengo };
