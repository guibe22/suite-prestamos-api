-- CreateEnum
CREATE TYPE "EstadoUbicacion" AS ENUM ('OK', 'SIN_RESPUESTA', 'PERMISO_DENEGADO', 'PERMISO_BLOQUEADO', 'PERMISO_REVOCADO', 'GPS_APAGADO', 'UBICACION_APROXIMADA', 'UBICACION_FALSA');

-- CreateTable
CREATE TABLE "EventoUbicacion" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "estado" "EstadoUbicacion" NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL,
    "hasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoUbicacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventoUbicacion_organizacionId_desde_idx" ON "EventoUbicacion"("organizacionId", "desde");

-- CreateIndex
CREATE INDEX "EventoUbicacion_usuarioId_desde_idx" ON "EventoUbicacion"("usuarioId", "desde");

-- AddForeignKey
ALTER TABLE "EventoUbicacion" ADD CONSTRAINT "EventoUbicacion_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoUbicacion" ADD CONSTRAINT "EventoUbicacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

