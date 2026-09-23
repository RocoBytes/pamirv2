-- AlterTable
ALTER TABLE "invitaciones" ADD COLUMN     "codigo_qr_id" TEXT;

-- CreateTable
CREATE TABLE "codigos_qr_invitacion" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_cifrado" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL DEFAULT 'SOCIO',
    "etiqueta" TEXT,
    "max_usos" INTEGER NOT NULL,
    "usos_restantes" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revocado_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" TEXT,

    CONSTRAINT "codigos_qr_invitacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "codigos_qr_invitacion_usos_restantes_check" CHECK ("usos_restantes" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "codigos_qr_invitacion_token_hash_key" ON "codigos_qr_invitacion"("token_hash");

-- CreateIndex
CREATE INDEX "codigos_qr_invitacion_organization_id_idx" ON "codigos_qr_invitacion"("organization_id");

-- CreateIndex
CREATE INDEX "codigos_qr_invitacion_creado_por_id_idx" ON "codigos_qr_invitacion"("creado_por_id");

-- CreateIndex
CREATE INDEX "invitaciones_codigo_qr_id_idx" ON "invitaciones"("codigo_qr_id");

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_codigo_qr_id_fkey" FOREIGN KEY ("codigo_qr_id") REFERENCES "codigos_qr_invitacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_qr_invitacion" ADD CONSTRAINT "codigos_qr_invitacion_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_qr_invitacion" ADD CONSTRAINT "codigos_qr_invitacion_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
