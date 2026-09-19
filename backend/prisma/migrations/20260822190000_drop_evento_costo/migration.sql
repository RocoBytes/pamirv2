-- Sin concepto de costo en eventos: la app es interna del club y las
-- actividades no manejan valores monetarios. La tabla está vacía (sin pérdida).

ALTER TABLE "eventos" DROP COLUMN "costo_texto";
