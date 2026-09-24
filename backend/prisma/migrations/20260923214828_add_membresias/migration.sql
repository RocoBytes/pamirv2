-- Membresías: pertenencia de una cuenta a un club con su rol EN ESE club.
-- Fase de expansión (1 de 2) del diseño multi-club — ver
-- docs/superpowers/specs/2026-09-23-multi-club-membership-design.md. Crea la
-- tabla y rellena una fila por cada usuario existente a partir de
-- users.organization_id y users.rol. users.organization_id/rol NO se tocan
-- todavía (siguen siendo la fuente de verdad de lectura hasta la migración
-- de contracción de una fase posterior) — así el rollback de esta imagen es
-- seguro sin perder datos.

-- CreateTable
CREATE TABLE "membresias" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "creado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membresias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membresias_usuario_id_idx" ON "membresias"("usuario_id");

-- CreateIndex
CREATE INDEX "membresias_organization_id_idx" ON "membresias"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "membresias_organization_id_usuario_id_key" ON "membresias"("organization_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "membresias" ADD CONSTRAINT "membresias_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresias" ADD CONSTRAINT "membresias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill ──────────────────────────────────────────────────────────────
-- Una fila por usuario existente. ON CONFLICT DO NOTHING vuelve la migración
-- segura de reintentar (por ejemplo si el deploy se corta después de crear la
-- tabla pero antes de terminar el backfill): reaplicar este INSERT no duplica
-- ni pisa una fila que ya quedó bien.
INSERT INTO "membresias" ("id", "organization_id", "usuario_id", "rol", "creado_at")
SELECT gen_random_uuid()::text, "organization_id", "id", "rol", CURRENT_TIMESTAMP
FROM "users"
ON CONFLICT ("organization_id", "usuario_id") DO NOTHING;
