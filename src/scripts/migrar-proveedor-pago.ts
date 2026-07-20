/**
 * Antes de correr `prisma db push` con el nuevo enum ProveedorPago
 * (REVENUE_CAT | MANUAL), la base puede tener filas viejas con
 * proveedor = 'PAYPAL' o 'GOOGLE_PLAY' — valores que ya no existen en el
 * schema. Postgres no puede convertir esos valores solo, así que hay que
 * remaparlos a 'MANUAL' a mano antes del push.
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

  if (afectadas.length === 0) {
    console.log('✅ No hay filas con proveedor PAYPAL/GOOGLE_PLAY — ya puedes correr `prisma db push --accept-data-loss` sin problema.');
    return;
  }

  console.log(`⚠️  ${afectadas.length} fila(s) con un proveedor que ya no existe en el schema:\n`);
  for (const fila of afectadas) {
    console.log(
      `  - ${fila.nombre} (org ${fila.organizacionId}) — proveedor=${fila.proveedor} estado=${fila.estado} periodoFinEn=${fila.periodoFinEn?.toISOString() ?? '—'}`
    );
  }

  const hayActivas = afectadas.some((f) => f.estado === 'ACTIVA');
  if (hayActivas && !forzar) {
    console.log(
      '\n🛑 Al menos una de estas suscripciones está ACTIVA — podría ser un cliente real que sí llegó a pagar por PayPal.' +
        '\n   Revísalas antes de continuar. Si igual quieres remapearlas todas a MANUAL, corre con --apply --force.'
    );
    process.exitCode = 1;
    return;
  }

  if (!aplicar) {
    console.log('\nEsto fue solo diagnóstico — nada se modificó. Corre con --apply para remapear estas filas a MANUAL.');
    return;
  }

  const resultado = await prisma.$executeRaw`
    UPDATE "Suscripcion"
    SET proveedor = 'MANUAL'
    WHERE proveedor::text IN ('PAYPAL', 'GOOGLE_PLAY')
  `;

  console.log(`\n✅ ${resultado} fila(s) remapeadas a proveedor=MANUAL.`);
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
