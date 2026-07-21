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

/**
 * Borra TODOS los datos de negocio (organizaciones, usuarios que no sean
 * SUPER_ADMIN, clientes, préstamos, cuotas, pagos, rutas, cajas, gastos,
 * jornadas, suscripciones) — se conservan intactos: los usuarios SUPER_ADMIN,
 * el catálogo de Planes, los Roles, y ConfiguracionSistema.
 *
 * Sin --confirmar solo IMPRIME lo que borraría (dry-run) — no toca la base.
 * Uso: npx tsx src/scripts/limpiar-datos.ts [--confirmar]
 */
async function main() {
  const confirmar = process.argv.includes('--confirmar');

  const usuariosABorrar = await prisma.usuario.findMany({
    where: { rol: { nombre: { not: 'SUPER_ADMIN' } } },
    select: { id: true, email: true, nombre: true },
  });
  const idsUsuariosABorrar = usuariosABorrar.map((u) => u.id);

  const usuariosAConservar = await prisma.usuario.findMany({
    where: { rol: { nombre: 'SUPER_ADMIN' } },
    select: { email: true, nombre: true },
  });

  const conteos = {
    organizaciones: await prisma.organizacion.count(),
    cuentas: await prisma.cuenta.count(),
    usuariosABorrar: usuariosABorrar.length,
    clientes: await prisma.cliente.count(),
    prestamos: await prisma.prestamo.count(),
    cuotas: await prisma.cuota.count(),
    pagos: await prisma.pago.count(),
    rutas: await prisma.ruta.count(),
    rutaColaboradores: await prisma.rutaColaborador.count(),
    cajas: await prisma.caja.count(),
    movimientosCaja: await prisma.movimientoCaja.count(),
    gastos: await prisma.gasto.count(),
    jornadas: await prisma.jornadaCobranza.count(),
    suscripciones: await prisma.suscripcion.count(),
    suscripcionEventos: await prisma.suscripcionEvento.count(),
    auditoriasDeUsuariosABorrar: await prisma.auditoria.count({
      where: { usuarioId: { in: idsUsuariosABorrar } },
    }),
  };

  console.log('📋 Esto es lo que se va a BORRAR:');
  console.log(JSON.stringify(conteos, null, 2));
  console.log('\n✅ Esto es lo que se va a CONSERVAR (usuarios SUPER_ADMIN):');
  console.log(usuariosAConservar.map((u) => `   - ${u.nombre} <${u.email}>`).join('\n') || '   (ninguno encontrado)');
  console.log('\n✅ También se conservan intactos: Plan, Rol, ConfiguracionSistema.');

  if (!confirmar) {
    console.log('\n🔒 Modo simulación (dry-run) — no se borró nada.');
    console.log('   Para borrar de verdad: npx tsx src/scripts/limpiar-datos.ts --confirmar');
    return;
  }

  console.log('\n🗑️  Borrando (--confirmar activado)...');

  await prisma.$transaction([
    prisma.auditoria.deleteMany({ where: { usuarioId: { in: idsUsuariosABorrar } } }),
    prisma.movimientoCaja.deleteMany(),
    prisma.gasto.deleteMany(),
    prisma.pago.deleteMany(),
    prisma.cuota.deleteMany(),
    prisma.prestamo.deleteMany(),
    prisma.documentoCliente.deleteMany(),
    prisma.aval.deleteMany(),
    prisma.referenciaCliente.deleteMany(),
    prisma.rutaColaborador.deleteMany(),
    prisma.caja.deleteMany(),
    prisma.jornadaCobranza.deleteMany(),
    prisma.cliente.deleteMany(),
    prisma.ruta.deleteMany(),
    prisma.suscripcionEvento.deleteMany(),
    prisma.suscripcion.deleteMany(),
    prisma.organizacion.deleteMany(),
    prisma.cuenta.deleteMany(),
    prisma.usuario.deleteMany({ where: { id: { in: idsUsuariosABorrar } } }),
  ]);

  console.log('✅ Limpieza completa. Solo quedan los usuarios SUPER_ADMIN, Planes, Roles y ConfiguracionSistema.');
}

main()
  .catch((e) => {
    console.error('❌ Error durante la limpieza:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
