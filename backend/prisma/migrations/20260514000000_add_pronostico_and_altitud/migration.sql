ALTER TABLE "salidas" ADD COLUMN "pronostico_file_id" TEXT;
ALTER TABLE "salidas" ADD COLUMN "pronostico_file_name" TEXT;
ALTER TABLE "salidas" ADD COLUMN "pronostico_file_url" TEXT;

ALTER TABLE "cierres" ADD COLUMN "altitud_maxima" INTEGER NOT NULL DEFAULT 0;
