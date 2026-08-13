import 'dotenv/config';
import { prisma } from '../config/database.js';
import { PagoService } from '../modules/pago/pago.service.js';

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const orgArgIndex = args.indexOf('--org');
  const orgId = orgArgIndex !== -1 ? args[orgArgIndex + 1] : null;

  console.log('--- REPARACIÓN Y RECÁLCULO DE PRÉSTAMOS AFECTADOS ---');
  console.log(isApply ? 'Modo: APLICAR CAMBIOS EN BD' : 'Modo: PREVISUALIZACIÓN (Usa --apply para guardar en BD)');

  const orgScope = orgId ? { cliente: { organizacionId: orgId } } : {};

  // Buscar préstamos que tengan al menos un pago en el historial (vigente o eliminado)
  const prestamos = await prisma.prestamo.findMany({
    where: {
      deletedAt: null,
      ...orgScope,
      pagos: {
        some: {},
      },
    },
    select: {
      id: true,
      codigo: true,
      cliente: {
        select: {
          nombres: true,
          apellidos: true,
        },
      },
    },
  });

  console.log(`Encontrados ${prestamos.length} préstamo(s) a procesar.`);

  if (!isApply) {
    console.log('\nSe previsualizó la lista de préstamos. Para recalcular y restaurar en BD ejecuta:');
    console.log('npx tsx src/scripts/reparar-prestamos.ts --apply\n');
    return;
  }

  const pagoService = new PagoService();
  let recalculados = 0;

  for (const p of prestamos) {
    const clienteNombre = `${p.cliente?.nombres || ''} ${p.cliente?.apellidos || ''}`.trim();
    try {
      await prisma.$transaction(async (tx) => {
        await pagoService.recalcularPrestamo(tx, p.id);
      });
      recalculados++;
      console.log(`✅ [${recalculados}/${prestamos.length}] Préstamo ${p.codigo || p.id} (${clienteNombre}) recalculado y restaurado.`);
    } catch (err: any) {
      console.error(`❌ Error al recalcular préstamo ${p.id}:`, err?.message || String(err));
    }
  }

  console.log(`\n🎉 Proceso completado. ${recalculados} préstamo(s) actualizados en base de datos.`);
}

main()
  .catch((e) => {
    console.error('Error catastrófico en script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
