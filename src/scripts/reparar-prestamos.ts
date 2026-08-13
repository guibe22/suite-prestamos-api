import 'dotenv/config';
import { prisma } from '../config/database.js';
import { PagoService } from '../modules/pago/pago.service.js';

function formatMoney(amount: number): string {
  return `RD$ ${Math.round(amount).toLocaleString('es-DO')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');

  const orgArgIndex = args.indexOf('--org');
  const orgId = orgArgIndex !== -1 ? args[orgArgIndex + 1] : null;

  const codigoArgIndex = args.indexOf('--codigo');
  const codigoFiltro = codigoArgIndex !== -1 ? args[codigoArgIndex + 1] : null;

  const idArgIndex = args.indexOf('--id');
  const idFiltro = idArgIndex !== -1 ? args[idArgIndex + 1] : null;

  console.log('============================================================');
  console.log('       🛠️  REPARACIÓN Y DIAGNÓSTICO DE PRÉSTAMOS           ');
  console.log('============================================================');
  console.log(isApply ? '⚠️  MODO: APLICAR CAMBIOS EN BASE DE DATOS' : '💡 MODO: DIAGNÓSTICO / PREVISUALIZACIÓN (Sin modificar BD)');
  if (codigoFiltro) console.log(`🔍 Filtro por Código: "${codigoFiltro}"`);
  if (idFiltro) console.log(`🔍 Filtro por ID: "${idFiltro}"`);
  console.log('------------------------------------------------------------\n');

  const whereClause: any = { deletedAt: null };
  if (orgId) whereClause.cliente = { organizacionId: orgId };
  if (codigoFiltro) {
    whereClause.codigo = { contains: codigoFiltro, mode: 'insensitive' };
  }
  if (idFiltro) {
    whereClause.id = idFiltro;
  }

  // Si no se especifica código/ID, buscamos preferentemente préstamos con pagos eliminados en historial
  if (!codigoFiltro && !idFiltro) {
    whereClause.pagos = { some: { deletedAt: { not: null } } };
  }

  const prestamos = await prisma.prestamo.findMany({
    where: whereClause,
    select: {
      id: true,
      codigo: true,
      monto: true,
      plazo: true,
      tasaInteres: true,
      estado: true,
      moraAcumulada: true,
      moraFechaCalculo: true,
      createdAt: true,
      cliente: {
        select: {
          nombres: true,
          apellidos: true,
          identificacion: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (prestamos.length === 0) {
    console.log('✅ No se encontraron préstamos desalineados o con cobros eliminados.');
    return;
  }

  const pagoService = new PagoService();
  let totalmenteAfectados = 0;
  let reparados = 0;

  for (const p of prestamos) {
    const clienteNombre = `${p.cliente?.nombres || ''} ${p.cliente?.apellidos || ''}`.trim();
    const clienteId = p.cliente?.identificacion || 'Sin cédula';
    const codigoPrestamo = p.codigo || p.id;

    const cuotas = await prisma.cuota.findMany({
      where: { prestamoId: p.id, deletedAt: null },
      orderBy: { numeroCuota: 'asc' },
    });

    const todosLosPagos = await prisma.pago.findMany({
      where: { prestamoId: p.id },
      orderBy: { fechaPago: 'asc' },
    });

    const pagosVigentes = todosLosPagos.filter((pg) => !pg.deletedAt);
    const pagosEliminados = todosLosPagos.filter((pg) => !!pg.deletedAt);

    const cuotasPagadasActuales = cuotas.filter((c) => c.estado === 'PAGADA').length;
    const totalMontoCuotasPagadasActual = cuotas.reduce((s, c) => s + Number(c.montoPagado || 0), 0);
    const totalMontoPagosHistoricos = todosLosPagos.reduce((s, pg) => s + Number(pg.monto || 0), 0);
    const montoInicialPagado = Math.max(0, totalMontoCuotasPagadasActual - totalMontoPagosHistoricos);

    const valorCuota = Number(cuotas[0]?.montoTotal || (Number(p.monto) * (1 + Number(p.tasaInteres) / 100)) / Number(p.plazo));
    const cuotasInicialesPagadas = Math.round(montoInicialPagado / (valorCuota || 1));
    const montoVigenteTotal = pagosVigentes.reduce((s, pg) => s + Number(pg.monto), 0);
    const cuotasVigentesPagadas = Math.round(montoVigenteTotal / (valorCuota || 1));
    const cuotasPostRecalculo = Math.min(Number(p.plazo), cuotasInicialesPagadas + cuotasVigentesPagadas);

    const desalineado = cuotasPagadasActuales !== cuotasPostRecalculo;

    if (desalineado) totalmenteAfectados++;

    // Si es un escaneo general y el préstamo NO está desalineado, omitir detalles largos
    if (!codigoFiltro && !idFiltro && !desalineado) {
      console.log(`✔️  Préstamo ${codigoPrestamo} (${clienteNombre}): OK (${cuotasPagadasActuales}/${p.plazo} cuotas). No requiere reparación.`);
      continue;
    }

    console.log(`\n📌 PRÉSTAMO: ${codigoPrestamo} ${desalineado ? '⚠️  [DESALINEADO DETECTADO]' : '✅ [ESTADO SALUDABLE]'}`);
    console.log(`   👤 Cliente: ${clienteNombre} (Doc: ${clienteId})`);
    console.log(`   📊 Estado actual: ${p.estado} | Mora acumulada: ${formatMoney(Number(p.moraAcumulada || 0))}`);
    console.log(`   🔢 Cuotas totales: ${p.plazo} | Cuota valor aprox: ${formatMoney(valorCuota)}`);
    console.log(`   💳 Pagos en tabla 'pagos': ${pagosVigentes.length} vigente(s), ${pagosEliminados.length} eliminado(s)`);
    console.log(`   --------------------------------------------------------`);
    console.log(`   📉 ESTADO ACTUAL EN BD:       ${cuotasPagadasActuales} / ${p.plazo} cuotas pagadas`);
    console.log(`   💡 BASE PAGADA DE INICIO:      ${cuotasInicialesPagadas} cuotas (${formatMoney(montoInicialPagado)})`);
    console.log(`   ✨ TRAS RECÁLCULO QUEDARÁN:  ${cuotasPostRecalculo} / ${p.plazo} cuotas pagadas`);

    if (desalineado) {
      console.log(`   🚨 DISCREPANCIA: Las cuotas pagadas pasarán de ${cuotasPagadasActuales} a ${cuotasPostRecalculo} cuotas.`);
    }

    if (pagosEliminados.length > 0) {
      const moraEliminadaTotal = pagosEliminados.reduce((s, pg) => s + Number(pg.moraCobrada || 0), 0);
      if (moraEliminadaTotal > 0) {
        console.log(`   🔄 Mora cobrada en pagos eliminados a restituir: ${formatMoney(moraEliminadaTotal)}`);
      }
    }

    if (isApply) {
      if (desalineado || codigoFiltro || idFiltro) {
        try {
          await prisma.$transaction(async (tx: any) => {
            await pagoService.recalcularPrestamo(tx, p.id);
          });
          reparados++;
          console.log(`   ✅ REPARADO Y RESTAURADO EN BASE DE DATOS ÉXITOSAMENTE.`);
        } catch (err: any) {
          console.log(`   ❌ ERROR AL REPARAR: ${err?.message || String(err)}`);
        }
      } else {
        console.log(`   ℹ️  No requiere reparación (ya está correcto).`);
      }
    } else {
      console.log(`   ℹ️  MODO DIAGNÓSTICO — No se realizaron cambios.`);
      if (desalineado) {
        console.log(`   👉 Para reparar este préstamo ejecuta:`);
        console.log(`      npx tsx src/scripts/reparar-prestamos.ts --codigo ${codigoPrestamo} --apply`);
      }
    }
  }

  console.log('\n============================================================');
  console.log(`📊 RESUMEN DEL DIAGNÓSTICO:`);
  console.log(`   Total analizados con pagos eliminados: ${prestamos.length}`);
  console.log(`   Préstamos desalineados a reparar:     ${totalmenteAfectados}`);
  if (isApply) {
    console.log(`   Préstamos reparados en BD:           ${reparados}`);
  }
  console.log('============================================================\n');
}

main()
  .catch((e) => {
    console.error('Error al ejecutar script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
