-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EstadoSuscripcion" AS ENUM ('TRIAL', 'ACTIVA', 'PENDIENTE_PAGO', 'SUSPENDIDA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "ProveedorPago" AS ENUM ('REVENUE_CAT', 'MANUAL');

-- CreateEnum
CREATE TYPE "DiaSemana" AS ENUM ('LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO');

-- CreateEnum
CREATE TYPE "EstadoCliente" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "NivelRiesgo" AS ENUM ('BAJO', 'MEDIO', 'ALTO');

-- CreateEnum
CREATE TYPE "CalificacionCliente" AS ENUM ('EXCELENTE', 'BUENO', 'REGULAR', 'RIESGOSO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('MASCULINO', 'FEMENINO', 'OTRO');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('CEDULA_FRENTE', 'CEDULA_REVERSO', 'CONTRATO', 'FOTO_CLIENTE', 'FOTO_VIVIENDA', 'FOTO_NEGOCIO', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoJornada" AS ENUM ('ABIERTA', 'CERRADA');

-- CreateTable
CREATE TABLE "Cuenta" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organizacion" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "identificacionTributaria" TEXT,
    "direccion" TEXT,
    "telefono" TEXT,
    "configuracion" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precioMensual" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'USD',
    "limites" JSONB NOT NULL,
    "revenueCatEntitlementId" TEXT,
    "esPredeterminado" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "diasTrial" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracionSistema" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "suscripcionesEnforcementEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionSistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suscripcion" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "proveedor" "ProveedorPago" NOT NULL,
    "estado" "EstadoSuscripcion" NOT NULL DEFAULT 'TRIAL',
    "trialTerminaEn" TIMESTAMP(3),
    "periodoInicioEn" TIMESTAMP(3),
    "periodoFinEn" TIMESTAMP(3),
    "canceladaEn" TIMESTAMP(3),
    "ultimoPagoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuscripcionEvento" (
    "id" TEXT NOT NULL,
    "suscripcionId" TEXT,
    "proveedor" "ProveedorPago" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "procesadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuscripcionEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ruta" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "zona" TEXT,
    "diaSemana" "DiaSemana" NOT NULL,
    "responsableId" TEXT,
    "color" TEXT,
    "descripcion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Ruta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RutaColaborador" (
    "id" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "RutaColaborador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rol" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "rolId" TEXT NOT NULL,
    "organizacionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "invitacionToken" TEXT,
    "invitacionExpiraEn" TIMESTAMP(3),
    "invitacionAceptadaEn" TIMESTAMP(3),

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT,
    "identificacion" TEXT,
    "fechaNacimiento" TIMESTAMP(3),
    "sexo" "Sexo",
    "telefono" TEXT NOT NULL,
    "telefono2" TEXT,
    "correo" TEXT,
    "direccion" TEXT NOT NULL,
    "sector" TEXT,
    "ciudad" TEXT,
    "provincia" TEXT,
    "referencia" TEXT,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "empresa" TEXT,
    "ocupacion" TEXT,
    "ingresosMensuales" DECIMAL(12,2),
    "puntuacion" INTEGER NOT NULL DEFAULT 100,
    "nivelRiesgo" "NivelRiesgo" NOT NULL DEFAULT 'BAJO',
    "calificacion" "CalificacionCliente" NOT NULL DEFAULT 'BUENO',
    "ordenRuta" INTEGER NOT NULL DEFAULT 0,
    "estado" "EstadoCliente" NOT NULL DEFAULT 'ACTIVO',
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenciaCliente" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "parentesco" TEXT,
    "telefono" TEXT NOT NULL,
    "direccion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenciaCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aval" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "identificacion" TEXT,
    "telefono" TEXT NOT NULL,
    "direccion" TEXT,
    "parentesco" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoCliente" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" "TipoDocumento" NOT NULL,
    "nombre" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prestamo" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "monto" DECIMAL(12,2) NOT NULL,
    "tasaInteres" DECIMAL(5,2) NOT NULL,
    "plazo" INTEGER NOT NULL,
    "estado" TEXT NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Prestamo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cuota" (
    "id" TEXT NOT NULL,
    "prestamoId" TEXT NOT NULL,
    "numeroCuota" INTEGER NOT NULL,
    "montoPrincipal" DECIMAL(12,2) NOT NULL,
    "montoInteres" DECIMAL(12,2) NOT NULL,
    "montoTotal" DECIMAL(12,2) NOT NULL,
    "montoPagado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "fechaPago" TIMESTAMP(3),
    "estado" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Cuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" TEXT NOT NULL,
    "prestamoId" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "fechaPago" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cajaId" TEXT,
    "jornadaId" TEXT,
    "metodoPago" TEXT NOT NULL,
    "referencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Caja" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "montoApertura" DECIMAL(12,2) NOT NULL,
    "montoCierre" DECIMAL(12,2),
    "fechaApertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaCierre" TIMESTAMP(3),
    "estado" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gasto" (
    "id" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "jornadaId" TEXT,
    "categoria" TEXT,
    "monto" DECIMAL(12,2) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "fechaGasto" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "Gasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "accion" TEXT NOT NULL,
    "tabla" TEXT NOT NULL,
    "registroId" TEXT,
    "valoresAnteriores" JSONB,
    "valoresNuevos" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sincronizacion" (
    "id" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "ultimoSincroAt" TIMESTAMP(3) NOT NULL,
    "tabla" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sincronizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jornadas_cobranza" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "saldoInicial" DECIMAL(12,2) NOT NULL,
    "saldoFinal" DECIMAL(12,2),
    "efectivoCobrado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "prestamos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gastos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "clientesVisitados" INTEGER NOT NULL DEFAULT 0,
    "clientesPendientes" INTEGER NOT NULL DEFAULT 0,
    "estado" "EstadoJornada" NOT NULL DEFAULT 'ABIERTA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "jornadas_cobranza_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_codigo_key" ON "Plan"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Suscripcion_organizacionId_key" ON "Suscripcion"("organizacionId");

-- CreateIndex
CREATE INDEX "Suscripcion_estado_idx" ON "Suscripcion"("estado");

-- CreateIndex
CREATE INDEX "Suscripcion_periodoFinEn_idx" ON "Suscripcion"("periodoFinEn");

-- CreateIndex
CREATE UNIQUE INDEX "SuscripcionEvento_externalEventId_key" ON "SuscripcionEvento"("externalEventId");

-- CreateIndex
CREATE INDEX "SuscripcionEvento_suscripcionId_idx" ON "SuscripcionEvento"("suscripcionId");

-- CreateIndex
CREATE UNIQUE INDEX "Ruta_organizacionId_codigo_key" ON "Ruta"("organizacionId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "RutaColaborador_rutaId_usuarioId_key" ON "RutaColaborador"("rutaId", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Rol_nombre_key" ON "Rol"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_invitacionToken_key" ON "Usuario"("invitacionToken");

-- CreateIndex
CREATE INDEX "Cliente_organizacionId_idx" ON "Cliente"("organizacionId");

-- CreateIndex
CREATE INDEX "Cliente_rutaId_idx" ON "Cliente"("rutaId");

-- CreateIndex
CREATE INDEX "Cliente_telefono_idx" ON "Cliente"("telefono");

-- CreateIndex
CREATE INDEX "Cliente_estado_idx" ON "Cliente"("estado");

-- CreateIndex
CREATE INDEX "Cliente_calificacion_idx" ON "Cliente"("calificacion");

-- CreateIndex
CREATE INDEX "Cliente_nivelRiesgo_idx" ON "Cliente"("nivelRiesgo");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_organizacionId_codigo_key" ON "Cliente"("organizacionId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_organizacionId_identificacion_key" ON "Cliente"("organizacionId", "identificacion");

-- AddForeignKey
ALTER TABLE "Organizacion" ADD CONSTRAINT "Organizacion_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suscripcion" ADD CONSTRAINT "Suscripcion_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suscripcion" ADD CONSTRAINT "Suscripcion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuscripcionEvento" ADD CONSTRAINT "SuscripcionEvento_suscripcionId_fkey" FOREIGN KEY ("suscripcionId") REFERENCES "Suscripcion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ruta" ADD CONSTRAINT "Ruta_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ruta" ADD CONSTRAINT "Ruta_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RutaColaborador" ADD CONSTRAINT "RutaColaborador_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "Ruta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RutaColaborador" ADD CONSTRAINT "RutaColaborador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "Ruta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenciaCliente" ADD CONSTRAINT "ReferenciaCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aval" ADD CONSTRAINT "Aval_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoCliente" ADD CONSTRAINT "DocumentoCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prestamo" ADD CONSTRAINT "Prestamo_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prestamo" ADD CONSTRAINT "Prestamo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuota" ADD CONSTRAINT "Cuota_prestamoId_fkey" FOREIGN KEY ("prestamoId") REFERENCES "Prestamo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_prestamoId_fkey" FOREIGN KEY ("prestamoId") REFERENCES "Prestamo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_jornadaId_fkey" FOREIGN KEY ("jornadaId") REFERENCES "jornadas_cobranza"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_jornadaId_fkey" FOREIGN KEY ("jornadaId") REFERENCES "jornadas_cobranza"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jornadas_cobranza" ADD CONSTRAINT "jornadas_cobranza_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jornadas_cobranza" ADD CONSTRAINT "jornadas_cobranza_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jornadas_cobranza" ADD CONSTRAINT "jornadas_cobranza_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "Ruta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
