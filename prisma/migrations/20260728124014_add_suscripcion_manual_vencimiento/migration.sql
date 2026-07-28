-- AlterTable
ALTER TABLE "Suscripcion" ADD COLUMN     "avisoDias" INTEGER,
ADD COLUMN     "avisoEnviadoEn" TIMESTAMP(3),
ADD COLUMN     "diasGraciaSuspension" INTEGER;
