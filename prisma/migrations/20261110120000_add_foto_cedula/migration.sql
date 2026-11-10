-- Foto de la cédula del cliente, habilitada por organización desde el panel
-- de plataforma (SUPER_ADMIN).

-- AlterTable
ALTER TABLE "Organizacion" ADD COLUMN "permiteFotoCedula" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FotoCedulaCliente" (
    "clienteId" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "imagenBase64" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "bytes" INTEGER NOT NULL,
    "subidaPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FotoCedulaCliente_pkey" PRIMARY KEY ("clienteId")
);

-- CreateIndex
CREATE INDEX "FotoCedulaCliente_organizacionId_idx" ON "FotoCedulaCliente"("organizacionId");

-- AddForeignKey
ALTER TABLE "FotoCedulaCliente" ADD CONSTRAINT "FotoCedulaCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FotoCedulaCliente" ADD CONSTRAINT "FotoCedulaCliente_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
