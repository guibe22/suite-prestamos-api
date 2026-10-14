-- AlterTable
ALTER TABLE "Pago" ADD COLUMN     "estadoUbicacion" TEXT,
ADD COLUMN     "latitud" DOUBLE PRECISION,
ADD COLUMN     "longitud" DOUBLE PRECISION,
ADD COLUMN     "precisionUbicacion" DOUBLE PRECISION,
ADD COLUMN     "ubicacionEn" TIMESTAMP(3);

