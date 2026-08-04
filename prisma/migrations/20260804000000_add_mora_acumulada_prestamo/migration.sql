-- AlterTable
-- IF NOT EXISTS porque estas dos columnas ya se habían aplicado con
-- `prisma db push` en los entornos de desarrollo antes de existir esta
-- migración; sin el guard, `migrate deploy` fallaría ahí con "column
-- already exists" y dejaría el historial de migraciones roto.
ALTER TABLE "Prestamo" ADD COLUMN IF NOT EXISTS "moraAcumulada" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "moraFechaCalculo" TIMESTAMP(3);
