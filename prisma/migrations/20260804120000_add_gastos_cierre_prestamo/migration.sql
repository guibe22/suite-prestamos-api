-- AlterTable
-- Gastos administrativos/de cierre retenidos del desembolso (ver migración v26
-- de WatermelonDB en la app). Nullable a propósito: NULL = préstamo anterior al
-- campo, sin retención — distinguirlo de un 0 explícito ayuda a auditar cuadres
-- viejos, y evita reescribir toda la tabla con un DEFAULT.
-- IF NOT EXISTS por el mismo motivo que la migración de moraAcumulada: los
-- entornos de desarrollo tienen drift de `prisma db push`.
ALTER TABLE "Prestamo" ADD COLUMN IF NOT EXISTS "gastosCierre" DECIMAL(12,2);
