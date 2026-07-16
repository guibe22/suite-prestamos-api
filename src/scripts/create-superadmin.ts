import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../utils/bcrypt.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Error: DATABASE_URL no está definido en el archivo .env o en el entorno.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('Uso: npx tsx src/scripts/create-superadmin.ts <email> <password> <nombre>');
    process.exit(1);
  }

  const [email, password, nombre] = args;
  const cleanEmail = email.trim().toLowerCase();

  console.log(`Creando/actualizando usuario SUPER_ADMIN con email: ${cleanEmail}...`);

  // 1. Obtener o crear el rol SUPER_ADMIN
  let rol = await prisma.rol.findUnique({
    where: { nombre: 'SUPER_ADMIN' },
  });

  if (!rol) {
    console.log('Rol SUPER_ADMIN no encontrado, creándolo...');
    rol = await prisma.rol.create({
      data: {
        nombre: 'SUPER_ADMIN',
        descripcion: 'Administrador general de todo el sistema',
      },
    });
  }

  // 2. Hashear la contraseña usando la misma función de la app
  const hashedPassword = await hashPassword(password);

  // 3. Crear o actualizar el usuario
  const usuario = await prisma.usuario.upsert({
    where: { email: cleanEmail },
    update: {
      nombre,
      password: hashedPassword,
      rolId: rol.id,
      organizacionId: null, // super admin no pertenece a ninguna organización en particular
    },
    create: {
      email: cleanEmail,
      nombre,
      password: hashedPassword,
      rolId: rol.id,
      organizacionId: null,
    },
  });

  console.log('✅ Usuario SUPER_ADMIN creado exitosamente:');
  console.log(`   ID: ${usuario.id}`);
  console.log(`   Nombre: ${usuario.nombre}`);
  console.log(`   Email: ${usuario.email}`);
}

main()
  .catch((e) => {
    console.error('❌ Error al crear el super admin:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
