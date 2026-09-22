-- Logo propio por club: clave del objeto en el bucket privado
-- (orgs/{id}/logo/{uuid}.{ext}), nunca una URL. Nullable y sin backfill: NULL
-- en las filas existentes es el estado correcto (siguen cayendo a
-- /logos/<slug>.png en el frontend). Sin índice — nunca se filtra por esta
-- columna.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "logo_object_key" TEXT;
