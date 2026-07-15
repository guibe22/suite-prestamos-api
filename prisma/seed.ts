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
