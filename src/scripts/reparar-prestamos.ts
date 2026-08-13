try {
  await import('dotenv/config');
} catch (_) {}
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

  // Flexible argument parser
  let codigoFiltro: string | null = null;
  let cuotasInicialesManual: number | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--codigo' || arg === '-c' || arg === 'codigo') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        codigoFiltro = args[i + 1];
        i++;
      }
    } else if (arg === '--cuotas-iniciales' || arg === '--iniciales' || arg === 'cuotas-iniciales') {
      if (args[i + 1]) {
        cuotasInicialesManual = parseInt(args[i + 1], 10);
        i++;
      }
    } else if (!arg.startsWith('-') && arg !== 'apply' && arg !== 'codigo' && !codigoFiltro) {
      codigoFiltro = arg;
    }
  }

  console.log('============================================================');
  console.log('       🛠️  REPARACIÓN Y DIAGNÓSTICO DE PRÉSTAMOS           ');
  console.log('============================================================');
  console.log(isApply ? '⚠️  MODO: APLICAR CAMBIOS EN BASE DE DATOS' : '💡 MODO: DIAGNÓSTICO / PREVISUALIZACIÓN (Sin modificar BD)');
  if (codigoFiltro) console.log(`🔍 Filtro de Préstamo: "${codigoFiltro}"`);
  if (cuotasInicialesManual !== null) console.log(`✏️  Cuotas Iniciales (Manual): ${cuotasInicialesManual}`);
  console.log('------------------------------------------------------------\n');

  const whereClause: any = { deletedAt: null };
  if (orgId) whereClause.cliente = { organizacionId: orgId };
  if (codigoFiltro) {
    whereClause.OR = [
      { codigo: { contains: codigoFiltro, mode: 'insensitive' } },
      { id: codigoFiltro },
    ];
  } else {
    // Si no se filtra un código específico, buscar préstamos con pagos eliminados
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
    console.log(`❌ No se encontró ningún préstamo con el filtro "${codigoFiltro || 'pagos eliminados'}".`);
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
    const valorCuota = Number(cuotas[0]?.montoTotal || (Number(p.monto) * (1 + Number(p.tasaInteres) / 100)) / Number(p.plazo));

    // Detección automática de cuotas nacidas como pre-pagadas:
    // Cuotas cuya fecha de vencimiento sea anterior a la fecha de creación del préstamo o del primer pago en tabla Pago
    const fechaCortePrimerPago = pagosVigentes.length > 0
      ? pagosVigentes[0].fechaPago.getTime()
      : p.createdAt.getTime();

    let cuotasInicialesDetectadas = 0;
    for (const c of cuotas) {
      const vencTs = c.fechaVencimiento.getTime();
      if (vencTs < fechaCortePrimerPago - 12 * 60 * 60 * 1000) {
        cuotasInicialesDetectadas++;
      }
    }

    const cuotasInicialesUsar = cuotasInicialesManual !== null ? cuotasInicialesManual : cuotasInicialesDetectadas;
    const montoInicialPagado = cuotasInicialesUsar * valorCuota;

    const montoVigenteTotal = pagosVigentes.reduce((s, pg) => s + Number(pg.monto), 0);
    const cuotasVigentesPagadas = Math.round(montoVigenteTotal / (valorCuota || 1));
    const cuotasPostRecalculo = Math.min(Number(p.plazo), cuotasInicialesUsar + cuotasVigentesPagadas);

    const desalineado = cuotasPagadasActuales !== cuotasPostRecalculo || (cuotasInicialesManual !== null);

    if (desalineado) totalmenteAfectados++;

    console.log(`📌 PRÉSTAMO: ${codigoPrestamo} ${desalineado ? '⚠️  [REVISIÓN / RECÁLCULO NECESARIO]' : '✅ [ESTADO SALUDABLE]'}`);
    console.log(`   👤 Cliente: ${clienteNombre} (Doc: ${clienteId})`);
    console.log(`   📊 Estado actual en BD: ${p.estado} | Mora acumulada: ${formatMoney(Number(p.moraAcumulada || 0))}`);
    console.log(`   🔢 Cuotas totales: ${p.plazo} | Valor cuota: ${formatMoney(valorCuota)}`);
    console.log(`   💳 Pagos en tabla 'pagos': ${pagosVigentes.length} vigente(s), ${pagosEliminados.length} eliminado(s)`);
    console.log(`   --------------------------------------------------------`);
    console.log(`   📉 ESTADO ACTUAL EN BD:       ${cuotasPagadasActuales} / ${p.plazo} cuotas pagadas`);
    console.log(`   💡 BASE DE CUOTAS INICIALES:   ${cuotasInicialesUsar} cuotas (${formatMoney(montoInicialPagado)}) ${cuotasInicialesManual !== null ? '[MANUAL]' : '[DETECTADO]'}`);
    console.log(`   ✨ TRAS RECÁLCULO QUEDARÁN:  ${cuotasPostRecalculo} / ${p.plazo} cuotas pagadas`);

    if (desalineado) {
      console.log(`   🚨 REAJUSTE: Las cuotas pagadas pasarán de ${cuotasPagadasActuales} a ${cuotasPostRecalculo} cuotas.`);
    }

    if (pagosEliminados.length > 0) {
      const moraEliminadaTotal = pagosEliminados.reduce((s, pg) => s + Number(pg.moraCobrada || 0), 0);
      if (moraEliminadaTotal > 0) {
        console.log(`   🔄 Mora cobrada en pagos eliminados a restituir: ${formatMoney(moraEliminadaTotal)}`);
      }
    }

    if (isApply) {
      try {
        await prisma.$transaction(async (tx: any) => {
          if (cuotasInicialesUsar > 0) {
            for (let i = 0; i < cuotas.length; i++) {
              const c = cuotas[i];
              const yaPagadaInicial = i < cuotasInicialesUsar;
              await tx.cuota.update({
                where: { id: c.id },
                data: {
                  montoPagado: yaPagadaInicial ? c.montoTotal : 0,
                  estado: yaPagadaInicial ? 'PAGADA' : 'PENDIENTE',
                  fechaPago: yaPagadaInicial ? c.fechaVencimiento : null,
                },
              });
            }
          }

          await pagoService.recalcularPrestamo(tx, p.id);
        });
        reparados++;
        console.log(`   ✅ REPARADO Y RESTAURADO EN BASE DE DATOS ÉXITOSAMENTE.`);
      } catch (err: any) {
        console.log(`   ❌ ERROR AL REPARAR: ${err?.message || String(err)}`);
      }
    } else {
      console.log(`   ℹ️  MODO DIAGNÓSTICO — No se realizaron cambios.`);
      console.log(`   👉 Para aplicar este recálculo ejecuta:`);
      console.log(`      tsx src/scripts/reparar-prestamos.ts ${codigoPrestamo} ${cuotasInicialesManual !== null ? `--cuotas-iniciales ${cuotasInicialesManual}` : ''} --apply`);
    }

    console.log('------------------------------------------------------------\n');
  }

  console.log('\n============================================================');
  console.log(`📊 RESUMEN DEL DIAGNÓSTICO:`);
  console.log(`   Total procesados:                  ${prestamos.length}`);
  console.log(`   Préstamos reajustados / a reparar: ${totalmenteAfectados}`);
  if (isApply) {
    console.log(`   Préstamos reparados en BD:         ${reparados}`);
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
