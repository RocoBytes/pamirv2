-- Reconcilia el historial de migraciones con schema.prisma.
--
-- Estas columnas, índices y la tabla dashboard_layouts se agregaron en su
-- momento con `prisma db push`, sin migración. En una base nueva el historial
-- quedaba incompleto y la aplicación fallaba en cada consulta a users/salidas.
--
-- Todo es idempotente (IF NOT EXISTS): en una base vacía crea lo que falta y en
-- una base que ya lo tiene por db push no hace nada. Generado con
-- `prisma migrate diff --from-config-datasource --to-schema` tras aplicar el
-- historial completo a una base vacía.

-- AlterTable
ALTER TABLE "cierres"
  ADD COLUMN IF NOT EXISTS "accidente_otro_descripcion" TEXT,
  ADD COLUMN IF NOT EXISTS "incidente_otro_descripcion" TEXT,
  ADD COLUMN IF NOT EXISTS "tipos_accidente" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "salidas"
  ADD COLUMN IF NOT EXISTS "es_registro_historico" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hora_inicio" TEXT,
  ADD COLUMN IF NOT EXISTS "integrantes_audit_log" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "recordatorio_cierre_enviado_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "temporada" TEXT;

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "password_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "reset_token" TEXT,
  ADD COLUMN IF NOT EXISTS "reset_token_expiry" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verification_token" TEXT;

-- Repetir el cambio de tipo sobre una columna que ya es TIMESTAMP(3) no tiene efecto.
ALTER TABLE "users" ALTER COLUMN "verification_token_expiry" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dashboard_layouts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dashboard_key" TEXT NOT NULL DEFAULT 'admin_analytics',
    "layout" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_layouts_user_id_dashboard_key_key" ON "dashboard_layouts"("user_id", "dashboard_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_verification_token_key" ON "users"("verification_token");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_reset_token_key" ON "users"("reset_token");

-- AddForeignKey (ADD CONSTRAINT no admite IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_layouts_user_id_fkey'
  ) THEN
    ALTER TABLE "dashboard_layouts"
      ADD CONSTRAINT "dashboard_layouts_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
