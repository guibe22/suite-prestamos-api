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

  // Planes de suscripción. Precios son placeholder (activo: false salvo
  // FREE/BASICO) hasta que se confirmen los definitivos — son datos, se
  // ajustan aquí sin tocar código. `limites` usa `null` para "sin límite".
  // Tabla acordada con Wilber (jul 2026):
  const planes = [
    {
      codigo: 'FREE',
      nombre: 'Gratis / Prueba',
      descripcion: 'Plan de prueba asignado automáticamente a organizaciones nuevas.',
      precioMensual: 0,
      moneda: 'USD',
      limites: {
        maxUsuarios: 2,
        maxClientes: 50,
        maxPrestamosActivos: 50,
        maxRutas: 2,
        reportesAvanzados: false,
        contratoPersonalizado: false,
        soportePrioritario: false,
      },
      esPredeterminado: true,
      activo: true,
      orden: 0,
    },
    {
      codigo: 'BASICO',
      nombre: 'Básico',
      descripcion: 'Plan Básico mensual.',
      precioMensual: 10,
      moneda: 'USD',
      limites: {
        maxUsuarios: 5,
        maxClientes: 300,
        maxPrestamosActivos: 500,
        maxRutas: 8,
        reportesAvanzados: false,
        contratoPersonalizado: true,
        soportePrioritario: false,
      },
      // Debe coincidir con el identificador del Entitlement creado en el
      // dashboard de RevenueCat para este plan.
      revenueCatEntitlementId: 'basico',
      esPredeterminado: false,
      activo: true,
      orden: 1,
    },
    {
      codigo: 'PRO',
      nombre: 'Pro',
      descripcion: 'Plan Pro mensual.',
      precioMensual: 25,
      moneda: 'USD',
      limites: {
        maxUsuarios: 15,
        maxClientes: 1500,
        maxPrestamosActivos: 3000,
        maxRutas: 25,
        reportesAvanzados: true,
        contratoPersonalizado: true,
        soportePrioritario: true,
      },
      revenueCatEntitlementId: 'pro',
      esPredeterminado: false,
      activo: true,
      orden: 2,
    },
    {
      codigo: 'EMPRESARIAL',
      nombre: 'Empresarial',
      descripcion: 'Sin límites de uso; precio a medida (contactar ventas). Pendiente de definir precio final.',
      precioMensual: 0,
      moneda: 'USD',
      limites: {
        maxUsuarios: null,
        maxClientes: null,
        maxPrestamosActivos: null,
        maxRutas: null,
        reportesAvanzados: true,
        contratoPersonalizado: true,
        soportePrioritario: true,
      },
      esPredeterminado: false,
      activo: true,
      orden: 3,
    },
  ];

  for (const plan of planes) {
    await prisma.plan.upsert({
      where: { codigo: plan.codigo },
      update: {
        nombre: plan.nombre,
        descripcion: plan.descripcion,
        precioMensual: plan.precioMensual,
        limites: plan.limites,
        revenueCatEntitlementId: (plan as { revenueCatEntitlementId?: string }).revenueCatEntitlementId,
        esPredeterminado: plan.esPredeterminado,
        activo: plan.activo,
        orden: plan.orden,
      },
      create: plan,
    });
  }
  console.log('✅ Planes de suscripción creados o actualizados.');

  // Ajustes globales del sistema (fila singleton) — enforcement apagado por
  // defecto, se activa desde el panel admin cuando esté listo.
  await prisma.configuracionSistema.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });
  console.log('✅ Configuración del sistema inicializada.');

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
