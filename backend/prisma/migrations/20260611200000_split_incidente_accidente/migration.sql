-- Split the single "ocurrio_incidente" question (NADA / INCIDENTES_MENORES /
-- ACCIDENTE_LESION / SUSTO) into two independent SI/NO fields. Legacy mapping:
--   ACCIDENTE_LESION              -> incidente NO, accidente SI
--   INCIDENTES_MENORES / SUSTO    -> incidente SI, accidente NO
--   NADA                          -> incidente NO, accidente NO
ALTER TABLE "cierres" ADD COLUMN "ocurrio_accidente" TEXT NOT NULL DEFAULT 'NO';

UPDATE "cierres"
SET "ocurrio_accidente" = 'SI'
WHERE "ocurrio_incidente" = 'ACCIDENTE_LESION';

UPDATE "cierres"
SET "ocurrio_incidente" = CASE
  WHEN "ocurrio_incidente" IN ('INCIDENTES_MENORES', 'SUSTO') THEN 'SI'
  WHEN "ocurrio_incidente" IN ('NADA', 'ACCIDENTE_LESION') THEN 'NO'
  ELSE "ocurrio_incidente"
END;
