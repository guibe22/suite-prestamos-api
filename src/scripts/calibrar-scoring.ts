import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Diagnóstico de calibración del scoring crediticio (Fase 3, jul 2026).
 * Script de SOLO LECTURA — no modifica ningún dato. No hay snapshot
 * histórico de "qué score tenía el cliente cuando se le dio este préstamo"
 * (Cliente.puntuacion siempre se sobreescribe con el valor actual), así que
 * se reconstruye analíticamente: para cada préstamo LIQUIDADO, se recalcula
 * qué score habría dado la fórmula actual usando SOLO las cuotas/préstamos
 * previos a la fecha en que ese préstamo se originó (fechaInicio), y se
 * compara contra el resultado real de ese préstamo (a tiempo / con mora).
 *
 * Con muy pocos préstamos liquidados en total (< 50 según Wilber), esto es
 * una señal DIRECCIONAL para revisar juntos, no una calibración estadística
 * robusta — no ajusta ningún peso automáticamente.
 *
 * Uso:
 *   npx tsx src/scripts/calibrar-scoring.ts
 *
 * Por defecto usa el DATABASE_URL del .env local. Para correrlo contra
 * producción, pasa la variable de entorno apuntando a esa base (de solo
 * lectura, no hace ningún UPDATE/DELETE):
 *   DATABASE_URL="postgresql://..." npx tsx src/scripts/calibrar-scoring.ts
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Error: DATABASE_URL no está definido en el archivo .env o en el entorno.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Copia PARAMETRIZADA (con fecha de referencia `asOf` en vez de Date.now())
 * de calcularPuntuacionYCalificacion. Existen ya 2 copias de esta fórmula
 * (suite-prestamos-app/src/utils/documentos.ts, la real; y
 * src/workers/score-recalc.worker.ts, la réplica server-side) — esta es una
 * tercera, necesaria porque las otras dos SIEMPRE miden "días de atraso"
 * contra hoy. Para reconstruir un score histórico hay que medirlo contra la
 * fecha en la que se originó cada préstamo pasado, no contra hoy.
 */
function calcularPuntuacionAsOf(
  cuotasVencidasAsOf: { fechaVencimiento: number; montoTotal: number; montoPagado: number }[],
  prestamosLiquidadosAsOf: number,
  asOf: number
): { puntuacion: number; calificacion: 'BUENO' | 'REGULAR' | 'RIESGOSO' } {
  let puntuacion = 100;

  if (cuotasVencidasAsOf.length > 0) {
    let penalizacion = 0;
    for (const c of cuotasVencidasAsOf) {
      const diasVencido = Math.max(0, Math.floor((asOf - c.fechaVencimiento) / 86_400_000));
      const severidad = Math.min(25, 8 + Math.floor(diasVencido / 5) * 2);
      const saldoCuota = Math.max(0, c.montoTotal - c.montoPagado);
      const factorMonto = c.montoTotal > 0 ? Math.min(1.5, saldoCuota / c.montoTotal) : 1;
      penalizacion += severidad * factorMonto;
    }
    puntuacion -= penalizacion;
  }

  puntuacion += Math.min(15, prestamosLiquidadosAsOf * 3);
  puntuacion = Math.max(10, Math.min(100, Math.round(puntuacion)));

  const calificacion = puntuacion >= 80 ? 'BUENO' : puntuacion >= 60 ? 'REGULAR' : 'RIESGOSO';
  return { puntuacion, calificacion };
}

interface FilaReporte {
  organizacionId: string;
  clienteId: string;
  prestamoId: string;
  fechaInicio: string;
  monto: number;
  scoreAlOrigen: number;
  calificacionAlOrigen: string;
  resultado: 'A_TIEMPO' | 'CON_MORA';
}

async function main() {
  console.log('Cargando datos...\n');

  const [prestamos, cuotas, organizaciones] = await Promise.all([
    prisma.prestamo.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        clienteId: true,
        monto: true,
        fechaInicio: true,
        estado: true,
        cliente: { select: { organizacionId: true } },
      },
    }),
    prisma.cuota.findMany({
      where: { deletedAt: null },
      select: { prestamoId: true, fechaVencimiento: true, fechaPago: true, montoTotal: true, montoPagado: true },
    }),
    prisma.organizacion.findMany({ select: { id: true, configuracion: true } }),
  ]);

  const diasGraciaPorOrg = new Map<string, number>();
  for (const org of organizaciones) {
    const config = org.configuracion as any;
    diasGraciaPorOrg.set(org.id, parseInt(config?.finanzas?.diasGracia) || 0);
  }

  const cuotasPorPrestamo = new Map<string, typeof cuotas>();
  for (const c of cuotas) {
    const arr = cuotasPorPrestamo.get(c.prestamoId) || [];
    arr.push(c);
    cuotasPorPrestamo.set(c.prestamoId, arr);
  }

  const prestamosPorCliente = new Map<string, typeof prestamos>();
  for (const p of prestamos) {
    const arr = prestamosPorCliente.get(p.clienteId) || [];
    arr.push(p);
    prestamosPorCliente.set(p.clienteId, arr);
  }

  const liquidados = prestamos.filter((p) => p.estado === 'LIQUIDADO');
  console.log(`${liquidados.length} préstamo(s) LIQUIDADO encontrados (de ${prestamos.length} totales).\n`);

  if (liquidados.length === 0) {
    console.log('No hay préstamos liquidados para analizar todavía.');
    await prisma.$disconnect();
    return;
  }

  const filas: FilaReporte[] = [];

  for (const target of liquidados) {
    const asOf = target.fechaInicio.getTime();
    const diasGracia = diasGraciaPorOrg.get(target.cliente.organizacionId) || 0;
    const otrosPrestamos = (prestamosPorCliente.get(target.clienteId) || []).filter(
      (p) => p.id !== target.id && p.fechaInicio.getTime() < asOf
    );

    // Reconstrucción: cuotas que ESTABAN vencidas y sin pagar justo cuando se
    // originó `target`, y préstamos previos que YA estaban liquidados en ese
    // momento — usando solo fechas ya guardadas (fechaVencimiento/fechaPago),
    // sin importar el estado ACTUAL de esas filas.
    const cuotasVencidasAsOf: { fechaVencimiento: number; montoTotal: number; montoPagado: number }[] = [];
    let prestamosLiquidadosAsOf = 0;

    for (const p of otrosPrestamos) {
      const cuotasP = cuotasPorPrestamo.get(p.id) || [];
      const todasPagadasAntes = cuotasP.length > 0 && cuotasP.every((c) => c.fechaPago && c.fechaPago.getTime() <= asOf);
      if (todasPagadasAntes) prestamosLiquidadosAsOf++;

      for (const c of cuotasP) {
        const vencidaAsOf = c.fechaVencimiento.getTime() < asOf;
        const pendienteAsOf = !c.fechaPago || c.fechaPago.getTime() > asOf;
        if (vencidaAsOf && pendienteAsOf) {
          cuotasVencidasAsOf.push({
            fechaVencimiento: c.fechaVencimiento.getTime(),
            montoTotal: Number(c.montoTotal),
            montoPagado: Number(c.montoPagado),
          });
        }
      }
    }

    const { puntuacion, calificacion } = calcularPuntuacionAsOf(cuotasVencidasAsOf, prestamosLiquidadosAsOf, asOf);

    // Resultado REAL de `target`: ¿alguna cuota se pagó después de su fecha de
    // vencimiento + los días de gracia de la organización? (mismo criterio
    // acordado en Fase 0/2 — "solo importa el resultado final").
    const cuotasTarget = cuotasPorPrestamo.get(target.id) || [];
    const tuvoMora = cuotasTarget.some((c) => {
      if (!c.fechaPago) return false;
      const diasAtraso = Math.floor((c.fechaPago.getTime() - c.fechaVencimiento.getTime()) / 86_400_000);
      return diasAtraso > diasGracia;
    });

    filas.push({
      organizacionId: target.cliente.organizacionId,
      clienteId: target.clienteId,
      prestamoId: target.id,
      fechaInicio: target.fechaInicio.toISOString().slice(0, 10),
      monto: Number(target.monto),
      scoreAlOrigen: puntuacion,
      calificacionAlOrigen: calificacion,
      resultado: tuvoMora ? 'CON_MORA' : 'A_TIEMPO',
    });
  }

  filas.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
  console.table(filas);

  const aTiempo = filas.filter((f) => f.resultado === 'A_TIEMPO');
  const conMora = filas.filter((f) => f.resultado === 'CON_MORA');
  const promedio = (arr: FilaReporte[]) =>
    arr.length ? Math.round(arr.reduce((s, f) => s + f.scoreAlOrigen, 0) / arr.length) : null;

  console.log('\n--- Resumen ---');
  console.log(`Total analizados: ${filas.length}`);
  console.log(`A TIEMPO: ${aTiempo.length} — score promedio al origen: ${promedio(aTiempo) ?? 'N/A'}`);
  console.log(`CON MORA: ${conMora.length} — score promedio al origen: ${promedio(conMora) ?? 'N/A'}`);
  console.log('\n⚠️  Muestra pequeña — tratar como señal direccional para revisar juntos, NO como calibración estadística robusta.');

  const promA = promedio(aTiempo);
  const promM = promedio(conMora);
  if (promA !== null && promM !== null && promM >= promA) {
    console.log(
      '⚠️  El score promedio de los que SÍ tuvieron mora es igual o mayor que el de los que pagaron a tiempo — posible señal de que la fórmula actual no está separando bien el riesgo real (o la muestra es demasiado chica para verlo todavía).'
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
