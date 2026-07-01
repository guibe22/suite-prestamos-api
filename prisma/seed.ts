import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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
