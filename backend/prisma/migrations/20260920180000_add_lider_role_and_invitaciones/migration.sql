-- Rol LIDER e invitaciones (sistema cerrado: las cuentas solo se crean al
-- aceptar una invitación). De la invitación solo se guarda el hash SHA-256 del
-- token; el token en claro viaja únicamente en el enlace enviado por correo.

-- AlterEnum
ALTER TYPE "RolUsuario" ADD VALUE IF NOT EXISTS 'LIDER';

-- CreateTable
CREATE TABLE "invitaciones" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL DEFAULT 'SOCIO',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "invitado_por_id" TEXT,
    "aceptada_at" TIMESTAMP(3),
    "usuario_id" TEXT,
    "revocada_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_token_hash_key" ON "invitaciones"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_usuario_id_key" ON "invitaciones"("usuario_id");

-- CreateIndex
CREATE INDEX "invitaciones_email_idx" ON "invitaciones"("email");

-- CreateIndex
CREATE INDEX "invitaciones_invitado_por_id_idx" ON "invitaciones"("invitado_por_id");

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_invitado_por_id_fkey" FOREIGN KEY ("invitado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
