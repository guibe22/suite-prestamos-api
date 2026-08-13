try {
  await import('dotenv/config');
} catch (_) {}
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function inspect47() {
  const codeArg = process.argv[2] || '47';
  console.log(`=== INSPECCIÓN DE PRÉSTAMO CON CÓDIGO: "${codeArg}" ===\n`);

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

  if (prestamos.length === 0) {
    console.log('No se encontró ningún préstamo.');
    return;
  }

  for (const p of prestamos) {
    console.log(`📌 PRÉSTAMO: ${p.codigo} (ID: ${p.id})`);
    console.log(`Cliente: ${p.cliente?.nombres} ${p.cliente?.apellidos}`);
    console.log(`Monto: ${p.monto} | Tasa: ${p.tasaInteres}% | Plazo: ${p.plazo} | Estado: ${p.estado}`);
    console.log(`Fecha Inicio: ${p.fechaInicio} (${new Date(Number(p.fechaInicio)).toISOString()})`);
    console.log(`CreatedAt: ${p.createdAt.toISOString()}`);
    console.log('\nPAGOS REGISTRADOS EN TABLA "PAGO":');
    if (p.pagos.length === 0) {
      console.log('  (Sin pagos en la tabla Pago)');
    }
    for (const pg of p.pagos) {
      console.log(`  - Pago ID: ${pg.id} | Monto: ${pg.monto} | MoraCobrada: ${pg.moraCobrada} | FechaPago: ${pg.fechaPago.toISOString()} | DeletedAt: ${pg.deletedAt ? pg.deletedAt.toISOString() : 'NULL'}`);
    }

    console.log('\nCUOTAS REGISTRADAS EN TABLA "CUOTA":');
    let cuotasPrePagadas = 0;
    const createdAtTs = p.createdAt.getTime();
    for (const c of p.cuotas) {
      const vencTs = c.fechaVencimiento.getTime();
      const esAnteriorACreatedAt = vencTs < createdAtTs - 12 * 60 * 60 * 1000;
      if (esAnteriorACreatedAt) cuotasPrePagadas++;
      console.log(`  - Cuota #${c.numeroCuota} | MontoTotal: ${c.montoTotal} | MontoPagado: ${c.montoPagado} | Estado: ${c.estado} | Vencimiento: ${c.fechaVencimiento.toISOString()} ${esAnteriorACreatedAt ? '⬅️ (Vencimiento anterior a fecha creación -> Cuota Inicial Prepagada)' : ''}`);
    }
    console.log(`\n💡 Total cuotas nacidas como pre-pagadas (vencimiento < creación): ${cuotasPrePagadas}`);
    console.log('====================================================\n');
  }
}

inspect47()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
