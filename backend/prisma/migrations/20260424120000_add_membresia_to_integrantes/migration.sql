-- AlterTable
ALTER TABLE "integrantes" ADD COLUMN     "membresia_club" TEXT NOT NULL DEFAULT 'NO_PERTENECE',
ADD COLUMN     "nombre_club" TEXT;
ALTER TABLE "integrantes" ALTER COLUMN "membresia_club" DROP DEFAULT;
