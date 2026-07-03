import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

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

  // 1. Roles
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

  // Obtener el rol de SUPER_ADMIN
  const superAdminRol = await prisma.rol.findUniqueOrThrow({
    where: { nombre: 'SUPER_ADMIN' },
  });

  // 2. Cuenta por defecto
  const cuentaDefecto = await prisma.cuenta.create({
    data: {
      nombre: 'Cuenta Demo',
      tipo: 'EMPRESA',
    },
  });
  console.log('✅ Cuenta creada:', cuentaDefecto.nombre);

  // 3. Organización por defecto
  const orgDefecto = await prisma.organizacion.create({
    data: {
      nombre: 'Organización Demo S.A.C.',
      cuentaId: cuentaDefecto.id,
    },
  });
  console.log('✅ Organización creada:', orgDefecto.nombre);

  // 4. Usuario Administrador por defecto
  const hashedPassword = await bcrypt.hash('AdminPassword123!', 10);
  const adminUser = await prisma.usuario.upsert({
    where: { email: 'admin@suite.com' },
    update: {},
    create: {
      nombre: 'Administrador Principal',
      email: 'admin@suite.com',
      password: hashedPassword,
      rolId: superAdminRol.id,
      organizacionId: orgDefecto.id,
    },
  });
  console.log('✅ Usuario Administrador creado:', adminUser.email);

  // Usar la organización REAL del admin (upsert puede devolver un admin
  // preexistente cuya org no sea la recién creada). Así el PULL, que filtra
  // clientes por la org del usuario autenticado, sí los devuelve.
  const orgIdAdmin = adminUser.organizacionId ?? orgDefecto.id;

  // 5. Ruta demo (los clientes requieren una ruta asignada)
  let rutaDemo = await prisma.ruta.findFirst({
    where: { organizacionId: orgIdAdmin },
  });
  if (!rutaDemo) {
    rutaDemo = await prisma.ruta.create({
      data: {
        organizacionId: orgIdAdmin,
        nombre: 'Ruta Demo Centro',
        codigo: 'RD-CENTRO',
        zona: 'Centro',
        diaSemana: 'LUNES',
      },
    });
  }
  console.log('✅ Ruta demo lista:', rutaDemo.nombre);

  // 6. Clientes demo (para tener datos de prueba que bajen por el PULL de sync)
  const clientesDemo = [
    { codigo: 'C-000001', nombres: 'Cliente Demo', apellidos: 'Uno', identificacion: '001-0000001-1', telefono: '809-000-0001', direccion: 'Av. Siempre Viva 100' },
    { codigo: 'C-000002', nombres: 'Cliente Demo', apellidos: 'Dos', identificacion: '001-0000002-2', telefono: '809-000-0002', direccion: 'Jr. Los Olivos 200' },
    { codigo: 'C-000003', nombres: 'Cliente Demo', apellidos: 'Tres', identificacion: '001-0000003-3', telefono: '809-000-0003', direccion: 'Calle Las Flores 300' },
  ];
  for (const c of clientesDemo) {
    await prisma.cliente.upsert({
      where: { organizacionId_codigo: { organizacionId: orgIdAdmin, codigo: c.codigo } },
      update: { ...c, organizacionId: orgIdAdmin, rutaId: rutaDemo.id },
      create: { ...c, organizacionId: orgIdAdmin, rutaId: rutaDemo.id },
    });
  }
  console.log(`✅ ${clientesDemo.length} clientes demo creados en la organización del admin (${orgIdAdmin}).`);

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
