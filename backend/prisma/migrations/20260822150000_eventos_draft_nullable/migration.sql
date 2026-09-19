-- E1: un borrador solo exige titulo. Las fechas y la categoría se completan
-- antes de publicar (la completitud se valida en el controlador al publicar).

ALTER TABLE "eventos" ALTER COLUMN "fecha_inicio" DROP NOT NULL, ALTER COLUMN "fecha_fin" DROP NOT NULL, ALTER COLUMN "categoria_id" DROP NOT NULL;
