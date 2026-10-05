-- CreateEnum
CREATE TYPE "CategoriaNotificacion" AS ENUM ('COBRANZA', 'JORNADA', 'EQUIPO', 'SUSCRIPCION', 'SINCRONIZACION');

-- CreateTable
CREATE TABLE "DispositivoPush" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "appVersion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoUsoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispositivoPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacion" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "categoria" "CategoriaNotificacion" NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "data" JSONB,
    "leidaEn" TIMESTAMP(3),
    "enviadaEn" TIMESTAMP(3),
    "errorEnvio" TEXT,
    "claveIdempotencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenciaNotificacion" (
    "usuarioId" TEXT NOT NULL,
    "cobranza" BOOLEAN NOT NULL DEFAULT true,
    "jornada" BOOLEAN NOT NULL DEFAULT true,
    "equipo" BOOLEAN NOT NULL DEFAULT true,
    "suscripcion" BOOLEAN NOT NULL DEFAULT true,
    "sincronizacion" BOOLEAN NOT NULL DEFAULT false,
    "sonido" BOOLEAN NOT NULL DEFAULT true,
    "vibracion" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenciaNotificacion_pkey" PRIMARY KEY ("usuarioId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispositivoPush_token_key" ON "DispositivoPush"("token");

-- CreateIndex
CREATE INDEX "DispositivoPush_usuarioId_activo_idx" ON "DispositivoPush"("usuarioId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "Notificacion_claveIdempotencia_key" ON "Notificacion"("claveIdempotencia");

-- CreateIndex
CREATE INDEX "Notificacion_usuarioId_leidaEn_idx" ON "Notificacion"("usuarioId", "leidaEn");

-- CreateIndex
CREATE INDEX "Notificacion_organizacionId_createdAt_idx" ON "Notificacion"("organizacionId", "createdAt");

-- AddForeignKey
ALTER TABLE "DispositivoPush" ADD CONSTRAINT "DispositivoPush_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenciaNotificacion" ADD CONSTRAINT "PreferenciaNotificacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

