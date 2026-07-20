/**
 * Antes de correr `prisma db push` con el nuevo enum ProveedorPago
 * (REVENUE_CAT | MANUAL), la base puede tener filas viejas con
 * proveedor = 'PAYPAL' o 'GOOGLE_PLAY' — valores que ya no existen en el
 * schema. Postgres no puede convertir esos valores solo, así que hay que
 * remaparlos a 'MANUAL' a mano antes del push.
 *
 * El enum lo usan DOS tablas (Suscripcion y SuscripcionEvento — el historial
 * de webhooks, que suele tener muchas más filas viejas de PayPal que
 * Suscripcion). Postgres no deja alterar el enum mientras CUALQUIERA de las
 * dos tenga un valor inválido, así que este script revisa y arregla ambas.
 *
 * Uso:
 *   npx tsx src/scripts/migrar-proveedor-pago.ts                 → solo diagnostica, no cambia nada
 *   npx tsx src/scripts/migrar-proveedor-pago.ts --apply         → aplica el remapeo (rechaza si hay alguna ACTIVA)
 *   npx tsx src/scripts/migrar-proveedor-pago.ts --apply --force → aplica igual aunque haya alguna ACTIVA
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Error: DATABASE_URL no está definido en el archivo .env o en el entorno.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface FilaAfectada {
  organizacionId: string;
  nombre: string;
  proveedor: string;
  estado: string;
  periodoFinEn: Date | null;
}

interface ConteoEventos {
  proveedor: string;
  total: bigint;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--apply');
  const forzar = args.includes('--force');

  // Nunca imprimir la connection string completa (trae la contraseña).
  const host = new URL(connectionString!).host;
  console.log(`🔎 Conectado a: ${host}\n`);

  const afectadas = await prisma.$queryRaw<FilaAfectada[]>`
    SELECT s."organizacionId", o.nombre, s.proveedor::text, s.estado::text, s."periodoFinEn"
    FROM "Suscripcion" s
    JOIN "Organizacion" o ON o.id = s."organizacionId"
    WHERE s.proveedor::text IN ('PAYPAL', 'GOOGLE_PLAY')
  `;

  const conteoEventos = await prisma.$queryRaw<ConteoEventos[]>`
    SELECT proveedor::text, COUNT(*) AS total
    FROM "SuscripcionEvento"
    WHERE proveedor::text IN ('PAYPAL', 'GOOGLE_PLAY')
    GROUP BY proveedor
  `;
  const totalEventos = conteoEventos.reduce((acc, c) => acc + Number(c.total), 0);

  if (afectadas.length === 0 && totalEventos === 0) {
    console.log('✅ No hay filas con proveedor PAYPAL/GOOGLE_PLAY — ya puedes correr `prisma db push --accept-data-loss` sin problema.');
    return;
  }

  if (afectadas.length > 0) {
    console.log(`⚠️  ${afectadas.length} suscripción(es) con un proveedor que ya no existe en el schema:\n`);
    for (const fila of afectadas) {
      console.log(
        `  - ${fila.nombre} (org ${fila.organizacionId}) — proveedor=${fila.proveedor} estado=${fila.estado} periodoFinEn=${fila.periodoFinEn?.toISOString() ?? '—'}`
      );
    }
    console.log();
  }

  if (totalEventos > 0) {
    console.log(`⚠️  ${totalEventos} evento(s) históricos en SuscripcionEvento con ese proveedor (auditoría de webhooks):`);
    for (const c of conteoEventos) {
      console.log(`  - proveedor=${c.proveedor}: ${c.total} evento(s)`);
    }
    console.log();
  }

  const hayActivas = afectadas.some((f) => f.estado === 'ACTIVA');
  if (hayActivas && !forzar) {
    console.log(
      '🛑 Al menos una de estas suscripciones está ACTIVA — podría ser un cliente real que sí llegó a pagar por PayPal.' +
        '\n   Revísala antes de continuar. Si igual quieres remapear todo a MANUAL, corre con --apply --force.'
    );
    process.exitCode = 1;
    return;
  }

  if (!aplicar) {
    console.log('Esto fue solo diagnóstico — nada se modificó. Corre con --apply para remapear todo a MANUAL.');
    return;
  }

  const resultadoSuscripcion = await prisma.$executeRaw`
    UPDATE "Suscripcion"
    SET proveedor = 'MANUAL'
    WHERE proveedor::text IN ('PAYPAL', 'GOOGLE_PLAY')
  `;
  const resultadoEventos = await prisma.$executeRaw`
    UPDATE "SuscripcionEvento"
    SET proveedor = 'MANUAL'
    WHERE proveedor::text IN ('PAYPAL', 'GOOGLE_PLAY')
  `;

  console.log(`✅ ${resultadoSuscripcion} suscripción(es) y ${resultadoEventos} evento(s) remapeados a proveedor=MANUAL.`);
  console.log('   Ahora sí puedes correr: npx prisma db push --accept-data-loss');
}

main()
  .catch((e) => {
    console.error('❌ Error migrando proveedor de pago:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
