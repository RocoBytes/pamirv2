-- Gestores por categoría: cada gestor puede crear y administrar eventos solo
-- de sus categorías asignadas; el rol ADMIN mantiene acceso total. Las
-- asignaciones se administran por SQL directo (sin UI en esta iteración).
-- Además reintroduce la categoría Excursionismo (café liberado por Trekking)
-- y renumera el orden del set final.

-- CreateTable
CREATE TABLE "gestores_categoria" (
    "id" SERIAL NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "categoria_id" INTEGER NOT NULL,
    "creado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gestores_categoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gestores_categoria_usuario_id_idx" ON "gestores_categoria"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "gestores_categoria_usuario_id_categoria_id_key" ON "gestores_categoria"("usuario_id", "categoria_id");

-- AddForeignKey
ALTER TABLE "gestores_categoria" ADD CONSTRAINT "gestores_categoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gestores_categoria" ADD CONSTRAINT "gestores_categoria_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Seeds idempotentes ───────────────────────────────────────────────────────

INSERT INTO "categorias_evento" ("slug", "nombre", "color", "orden", "activa")
VALUES ('excursionismo', 'Excursionismo', '#8B6A4F', 4, true)
ON CONFLICT ("slug") DO NOTHING;

UPDATE "categorias_evento" SET "orden" = 1 WHERE slug = 'montanismo-n1' AND "orden" <> 1;
UPDATE "categorias_evento" SET "orden" = 2 WHERE slug = 'montanismo-n2' AND "orden" <> 2;
UPDATE "categorias_evento" SET "orden" = 3 WHERE slug = 'senderismo' AND "orden" <> 3;
UPDATE "categorias_evento" SET "orden" = 4 WHERE slug = 'excursionismo' AND "orden" <> 4;
UPDATE "categorias_evento" SET "orden" = 5 WHERE slug = 'cursos-talleres' AND "orden" <> 5;
UPDATE "categorias_evento" SET "orden" = 6 WHERE slug = 'escalada' AND "orden" <> 6;
