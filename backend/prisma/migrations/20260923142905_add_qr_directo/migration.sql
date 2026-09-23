/*
  Warnings:

  - A unique constraint covering the columns `[registrado_usuario_id]` on the table `codigos_qr_invitacion` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ModoCodigoQr" AS ENUM ('CORREO', 'DIRECTO');

-- AlterTable
ALTER TABLE "codigos_qr_invitacion" ADD COLUMN     "modo" "ModoCodigoQr" NOT NULL DEFAULT 'CORREO',
ADD COLUMN     "registrado_usuario_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "codigos_qr_invitacion_registrado_usuario_id_key" ON "codigos_qr_invitacion"("registrado_usuario_id");

-- AddForeignKey
ALTER TABLE "codigos_qr_invitacion" ADD CONSTRAINT "codigos_qr_invitacion_registrado_usuario_id_fkey" FOREIGN KEY ("registrado_usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
