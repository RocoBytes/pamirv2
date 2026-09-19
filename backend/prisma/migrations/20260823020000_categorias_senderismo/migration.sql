-- Reestructura de categorías: Trekking y Excursiones se reemplazan por una
-- única categoría Senderismo (hereda el verde de Excursiones). Set final:
-- Montañismo N°1, Montañismo N°2, Senderismo, Cursos y talleres, Escalada.
-- Pasos idempotentes; los eventos que apuntaran a las categorías eliminadas
-- se reasignan a Senderismo antes de borrarlas.

INSERT INTO "categorias_evento" ("slug", "nombre", "color", "orden", "activa")
VALUES ('senderismo', 'Senderismo', '#4E805D', 3, true)
ON CONFLICT ("slug") DO NOTHING;

UPDATE "eventos" SET "categoria_id" = (SELECT id FROM "categorias_evento" WHERE slug = 'senderismo')
WHERE "categoria_id" IN (SELECT id FROM "categorias_evento" WHERE slug IN ('trekking', 'excursiones'));

DELETE FROM "categorias_evento" WHERE slug IN ('trekking', 'excursiones');

UPDATE "categorias_evento" SET "orden" = 1 WHERE slug = 'montanismo-n1' AND "orden" <> 1;
UPDATE "categorias_evento" SET "orden" = 2 WHERE slug = 'montanismo-n2' AND "orden" <> 2;
UPDATE "categorias_evento" SET "orden" = 3 WHERE slug = 'senderismo' AND "orden" <> 3;
UPDATE "categorias_evento" SET "orden" = 4 WHERE slug = 'cursos-talleres' AND "orden" <> 4;
UPDATE "categorias_evento" SET "orden" = 5 WHERE slug = 'escalada' AND "orden" <> 5;
