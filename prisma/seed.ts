import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 con driver adapters requiere pasar el adapter (igual que en
// src/config/database.ts). new PrismaClient() a secas lanza
// "PrismaClient needs to be constructed with a non-empty, valid PrismaClientOptions".
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be defined');
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Iniciando la siembra de la base de datos...');

  // Roles
  const roles = [
    { nombre: 'SUPER_ADMIN', descripcion: 'Administrador general de todo el sistema' },
    { nombre: 'ADMIN', descripcion: 'Administrador de la organización' },
    { nombre: 'COBRADOR', descripcion: 'Usuario con permisos de cobro y registro de pagos' },
  ];

  for (const rol of roles) {
    await prisma.rol.upsert({
      where: { nombre: rol.nombre },
      update: { descripcion: rol.descripcion },
      create: rol,
    });
  }
  console.log('✅ Roles creados o actualizados.');

  // Planes de suscripción. Precios y límites son placeholder (activo: false
  // salvo el FREE/trial) hasta que se confirmen los definitivos — son datos,
  // se ajustan aquí sin tocar código.
  const planes = [
    {
      codigo: 'FREE',
      nombre: 'Gratis / Prueba',
      descripcion: 'Plan de prueba asignado automáticamente a organizaciones nuevas.',
      precioMensual: 0,
      moneda: 'USD',
      limites: { maxUsuarios: 2, maxClientes: 50, maxRutas: 2 },
      esPredeterminado: true,
      activo: true,
      orden: 0,
    },
    {
      codigo: 'BASICO',
      nombre: 'Básico',
      descripcion: 'Plan pendiente de definir precio/límites finales.',
      precioMensual: 0,
      moneda: 'USD',
      limites: { maxUsuarios: 5, maxClientes: 500, maxRutas: 10 },
      esPredeterminado: false,
      activo: false,
      orden: 1,
    },
    {
      codigo: 'PRO',
      nombre: 'Pro',
      descripcion: 'Plan pendiente de definir precio/límites finales.',
      precioMensual: 0,
      moneda: 'USD',
      limites: { maxUsuarios: 20, maxClientes: 5000, maxRutas: 50 },
      esPredeterminado: false,
      activo: false,
      orden: 2,
    },
  ];

  for (const plan of planes) {
    await prisma.plan.upsert({
      where: { codigo: plan.codigo },
      update: {
        nombre: plan.nombre,
        descripcion: plan.descripcion,
        limites: plan.limites,
        esPredeterminado: plan.esPredeterminado,
        orden: plan.orden,
      },
      create: plan,
    });
  }
  console.log('✅ Planes de suscripción creados o actualizados.');

  console.log('🏁 Proceso de siembra finalizado con éxito.');
}

main()
  .catch((e) => {
    console.error('❌ Error en el proceso de siembra:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
