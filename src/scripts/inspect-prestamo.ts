try {
  await import('dotenv/config');
} catch (_) {}
import { prisma } from '../config/database.js';

async function inspect() {
  const codeArg = process.argv[2] || '00047';
  console.log(`Inspeccionando préstamo con código/ID conteniendo: "${codeArg}"...\n`);

  const prestamos = await prisma.prestamo.findMany({
    where: {
      OR: [
        { codigo: { contains: codeArg, mode: 'insensitive' } },
        { id: codeArg },
      ],
    },
    include: {
      cliente: true,
      cuotas: { orderBy: { numeroCuota: 'asc' } },
      pagos: { orderBy: { fechaPago: 'asc' } },
    },
  });

  for (const p of prestamos) {
    console.log('====================================================');
    console.log(`PRÉSTAMO: ${p.codigo} (ID: ${p.id})`);
    console.log(`Cliente: ${p.cliente?.nombres} ${p.cliente?.apellidos} (ID: ${p.clienteId})`);
    console.log(`Monto: ${p.monto} | Tasa: ${p.tasaInteres}% | Plazo: ${p.plazo} | Estado: ${p.estado}`);
    console.log(`Fecha Inicio: ${p.fechaInicio} | CreatedAt: ${p.createdAt}`);
    console.log('----------------------------------------------------');
    console.log('PAGOS EN HISTORIAL (Vigentes y Eliminados):');
    for (const pg of p.pagos) {
      console.log(`  - Pago ID: ${pg.id} | Monto: ${pg.monto} | MoraCobrada: ${pg.moraCobrada} | FechaPago: ${pg.fechaPago} | DeletedAt: ${pg.deletedAt}`);
    }
    console.log('----------------------------------------------------');
    console.log('CUOTAS EN DB ACTUALMENTE:');
    for (const c of p.cuotas) {
      console.log(`  - Cuota #${c.numeroCuota} | MontoTotal: ${c.montoTotal} | MontoPagado: ${c.montoPagado} | Estado: ${c.estado} | Vencimiento: ${c.fechaVencimiento} | FechaPago: ${c.fechaPago} | CreatedAt: ${c.createdAt} | UpdatedAt: ${c.updatedAt}`);
    }
    console.log('====================================================\n');
  }
}

inspect()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
