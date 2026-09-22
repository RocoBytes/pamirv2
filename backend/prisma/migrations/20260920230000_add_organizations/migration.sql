-- Clubes (multi-tenant): tabla organizations y organization_id en las 15
-- tablas de negocio, también en las hijas (desnormalizado a propósito).
--
-- Escrita a mano a partir de `prisma migrate diff`, reordenada para que sea
-- segura sobre una base con datos: las columnas se agregan nulas, se rellenan
-- con el club Pamir (todas las filas anteriores a esta migración son suyas) y
-- recién entonces se vuelven obligatorias. app_secrets queda global.

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "membresia_propia" TEXT NOT NULL,
    "alert_email" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "ultimo_numero_salida" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- Club n.º 1: Pamir. El id es fijo para que la migración sea reproducible. El
-- contador de salidas parte en el mayor número ya usado, porque la secuencia
-- global deja de existir más abajo.
INSERT INTO "organizations" (
    "id", "slug", "name", "short_name", "membresia_propia",
    "alert_email", "contact_name", "contact_email",
    "ultimo_numero_salida", "updated_at"
)
SELECT
    '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01', 'pamir', 'Andino Club Pamir', 'Pamir', 'SOCIO_ANDINO_PAMIR',
    'seguridad.acp.cl@gmail.com', 'El equipo de Pamir', 'seguridad.acp.cl@gmail.com',
    COALESCE((SELECT MAX("numero_salida") FROM "salidas"), 0), CURRENT_TIMESTAMP;

-- Paso 1: columnas nulas.
ALTER TABLE "users" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "dashboard_layouts" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "invitaciones" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "salidas" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "evaluacion_tokens" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "evaluacion_respuestas" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "cierres" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "documentos" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "integrantes" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "categorias_evento" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "gestores_categoria" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "declaracion_jurada_versiones" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "eventos" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "inscripciones" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "notificaciones" ADD COLUMN "organization_id" TEXT;

-- Paso 2: relleno. Asignación constante: no depende del orden entre tablas ni
-- de llaves foráneas (documentos e integrantes no tienen ninguna).
UPDATE "users" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "dashboard_layouts" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "invitaciones" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "salidas" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "evaluacion_tokens" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "evaluacion_respuestas" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "cierres" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "documentos" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "integrantes" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "categorias_evento" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "gestores_categoria" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "declaracion_jurada_versiones" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "eventos" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "inscripciones" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;
UPDATE "notificaciones" SET "organization_id" = '7a1e3f52-9c0b-4d6a-8f11-2b5c9e7d4a01' WHERE "organization_id" IS NULL;

-- Paso 3: obligatorias.
ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "dashboard_layouts" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "invitaciones" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "salidas" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "evaluacion_tokens" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "evaluacion_respuestas" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "cierres" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "documentos" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "integrantes" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "categorias_evento" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "gestores_categoria" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "declaracion_jurada_versiones" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "eventos" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "inscripciones" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "notificaciones" ALTER COLUMN "organization_id" SET NOT NULL;

-- El número de salida pasa a ser por club: lo asigna la aplicación con el
-- contador de organizations. Primero se quita el valor por defecto; Postgres no
-- deja borrar una secuencia que una columna todavía referencia.
ALTER TABLE "salidas" ALTER COLUMN "numero_salida" DROP DEFAULT;
DROP SEQUENCE "salidas_numero_salida_seq";

-- Unicidades que dejan de ser globales.
DROP INDEX "categorias_evento_slug_key";
DROP INDEX "declaracion_jurada_versiones_version_key";
DROP INDEX "integrantes_rut_key";
DROP INDEX "salidas_numero_salida_key";

-- CreateIndex
CREATE UNIQUE INDEX "categorias_evento_organization_id_slug_key" ON "categorias_evento"("organization_id", "slug");
CREATE UNIQUE INDEX "declaracion_jurada_versiones_organization_id_version_key" ON "declaracion_jurada_versiones"("organization_id", "version");
CREATE UNIQUE INDEX "integrantes_organization_id_rut_key" ON "integrantes"("organization_id", "rut");
CREATE UNIQUE INDEX "salidas_organization_id_numero_salida_key" ON "salidas"("organization_id", "numero_salida");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
CREATE INDEX "dashboard_layouts_organization_id_idx" ON "dashboard_layouts"("organization_id");
CREATE INDEX "invitaciones_organization_id_idx" ON "invitaciones"("organization_id");
CREATE INDEX "salidas_organization_id_idx" ON "salidas"("organization_id");
CREATE INDEX "evaluacion_tokens_organization_id_idx" ON "evaluacion_tokens"("organization_id");
CREATE INDEX "evaluacion_respuestas_organization_id_idx" ON "evaluacion_respuestas"("organization_id");
CREATE INDEX "cierres_organization_id_idx" ON "cierres"("organization_id");
CREATE INDEX "documentos_organization_id_idx" ON "documentos"("organization_id");
CREATE INDEX "integrantes_organization_id_idx" ON "integrantes"("organization_id");
CREATE INDEX "categorias_evento_organization_id_idx" ON "categorias_evento"("organization_id");
CREATE INDEX "gestores_categoria_organization_id_idx" ON "gestores_categoria"("organization_id");
CREATE INDEX "declaracion_jurada_versiones_organization_id_idx" ON "declaracion_jurada_versiones"("organization_id");
CREATE INDEX "eventos_organization_id_idx" ON "eventos"("organization_id");
CREATE INDEX "inscripciones_organization_id_idx" ON "inscripciones"("organization_id");
CREATE INDEX "notificaciones_organization_id_idx" ON "notificaciones"("organization_id");

-- AddForeignKey. RESTRICT: borrar un club nunca arrastra sus datos.
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salidas" ADD CONSTRAINT "salidas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluacion_tokens" ADD CONSTRAINT "evaluacion_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluacion_respuestas" ADD CONSTRAINT "evaluacion_respuestas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierres" ADD CONSTRAINT "cierres_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integrantes" ADD CONSTRAINT "integrantes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "categorias_evento" ADD CONSTRAINT "categorias_evento_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gestores_categoria" ADD CONSTRAINT "gestores_categoria_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "declaracion_jurada_versiones" ADD CONSTRAINT "declaracion_jurada_versiones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inscripciones" ADD CONSTRAINT "inscripciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
