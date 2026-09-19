-- Add correlative salida number. Backfill existing rows in chronological order
-- (created_at) so historical salidas get coherent correlatives, then attach an
-- owned sequence so new inserts continue from MAX + 1.
ALTER TABLE "salidas" ADD COLUMN "numero_salida" INTEGER;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "created_at" ASC) AS rn
  FROM "salidas"
)
UPDATE "salidas" s
SET "numero_salida" = o.rn
FROM ordered o
WHERE s.id = o.id;

CREATE SEQUENCE "salidas_numero_salida_seq" OWNED BY "salidas"."numero_salida";
SELECT setval('"salidas_numero_salida_seq"', COALESCE((SELECT MAX("numero_salida") FROM "salidas"), 0) + 1, false);
ALTER TABLE "salidas" ALTER COLUMN "numero_salida" SET DEFAULT nextval('"salidas_numero_salida_seq"');
ALTER TABLE "salidas" ALTER COLUMN "numero_salida" SET NOT NULL;

CREATE UNIQUE INDEX "salidas_numero_salida_key" ON "salidas"("numero_salida");
