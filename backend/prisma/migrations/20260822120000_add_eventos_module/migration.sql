-- Módulo de eventos del club: calendario de actividades e inscripciones.
-- Agrega el rol de usuario (SOCIO/ADMIN), las categorías de evento, las
-- versiones de la declaración jurada del participante, los eventos con su
-- ciclo de vida, las inscripciones y la cola idempotente de notificaciones.
-- Incluye seeds idempotentes: 6 categorías, la declaración vigente 2026-08
-- y la promoción del administrador de eventos.

-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('SOCIO', 'ADMIN');

-- CreateEnum
CREATE TYPE "EstadoEvento" AS ENUM ('BORRADOR', 'PUBLICADO', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoInscripcion" AS ENUM ('POSTULADO', 'RETIRADO', 'SELECCIONADO', 'NO_SELECCIONADO');

-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('INSCRIPCION_CONFIRMADA', 'SELECCIONADO', 'NO_SELECCIONADO', 'EVENTO_CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoNotificacion" AS ENUM ('PENDIENTE', 'ENVIADA', 'ERROR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "rol" "RolUsuario" NOT NULL DEFAULT 'SOCIO';

-- CreateTable
CREATE TABLE "categorias_evento" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaracion_jurada_versiones" (
    "id" SERIAL NOT NULL,
    "version" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "hash_sha256" TEXT NOT NULL,
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMP(3),

    CONSTRAINT "declaracion_jurada_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "categoria_id" INTEGER NOT NULL,
    "estado" "EstadoEvento" NOT NULL DEFAULT 'BORRADOR',
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "hora_inicio" TEXT,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "duracion_texto" TEXT,
    "ubicacion" TEXT,
    "reunion_coordinacion" TEXT,
    "organizador_nombre" TEXT,
    "altura_maxima_msnm" INTEGER,
    "dificultad" INTEGER,
    "costo_texto" TEXT,
    "cupos" INTEGER,
    "fecha_corte" TIMESTAMP(3),
    "objetivo" TEXT,
    "itinerario" TEXT,
    "incluye" TEXT,
    "no_incluye" TEXT,
    "recomendaciones" TEXT,
    "aviso_destacado" TEXT,
    "creado_por" TEXT NOT NULL,
    "creado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMP(3) NOT NULL,
    "publicado_at" TIMESTAMP(3),
    "finalizado_at" TIMESTAMP(3),
    "finalizado_por" TEXT,
    "cancelado_at" TIMESTAMP(3),
    "motivo_cancelacion" TEXT,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inscripciones" (
    "id" TEXT NOT NULL,
    "evento_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "estado" "EstadoInscripcion" NOT NULL DEFAULT 'POSTULADO',
    "tiene_vehiculo" BOOLEAN NOT NULL,
    "cupos_vehiculo" INTEGER,
    "declaracion_version_id" INTEGER NOT NULL,
    "declaracion_aceptada_at" TIMESTAMP(3) NOT NULL,
    "declaracion_ip" TEXT,
    "declaracion_user_agent" TEXT,
    "postulado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retirado_at" TIMESTAMP(3),
    "resuelto_at" TIMESTAMP(3),

    CONSTRAINT "inscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL,
    "inscripcion_id" TEXT NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "estado" "EstadoNotificacion" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimo_error" TEXT,
    "proveedor_id" TEXT,
    "creada_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviada_at" TIMESTAMP(3),

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_evento_slug_key" ON "categorias_evento"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "declaracion_jurada_versiones_version_key" ON "declaracion_jurada_versiones"("version");

-- CreateIndex
CREATE INDEX "eventos_estado_fecha_inicio_idx" ON "eventos"("estado", "fecha_inicio");

-- CreateIndex
CREATE INDEX "eventos_categoria_id_idx" ON "eventos"("categoria_id");

-- CreateIndex
CREATE INDEX "inscripciones_evento_id_estado_idx" ON "inscripciones"("evento_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "inscripciones_evento_id_usuario_id_key" ON "inscripciones"("evento_id", "usuario_id");

-- CreateIndex
CREATE INDEX "notificaciones_estado_idx" ON "notificaciones"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "notificaciones_inscripcion_id_tipo_key" ON "notificaciones"("inscripcion_id", "tipo");

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_evento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_finalizado_por_fkey" FOREIGN KEY ("finalizado_por") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscripciones" ADD CONSTRAINT "inscripciones_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscripciones" ADD CONSTRAINT "inscripciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscripciones" ADD CONSTRAINT "inscripciones_declaracion_version_id_fkey" FOREIGN KEY ("declaracion_version_id") REFERENCES "declaracion_jurada_versiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_inscripcion_id_fkey" FOREIGN KEY ("inscripcion_id") REFERENCES "inscripciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Seeds idempotentes ───────────────────────────────────────────────────────

-- Categorías de actividades del club (colores para los chips del calendario)
INSERT INTO "categorias_evento" ("slug", "nombre", "color", "orden", "activa") VALUES
  ('montanismo-n1',   'Montañismo N°1',    '#E8862E', 1, true),
  ('montanismo-n2',   'Montañismo N°2',    '#2F6BD6', 2, true),
  ('excursiones',     'Excursiones',       '#4E805D', 3, true),
  ('trekking',        'Trekking',          '#8B6A4F', 4, true),
  ('cursos-talleres', 'Cursos y talleres', '#29A8DF', 5, true),
  ('escalada',        'Escalada',          '#D9A514', 6, true)
ON CONFLICT ("slug") DO NOTHING;

-- Declaración jurada vigente. hash_sha256 = sha256(titulo + '\n' + items.join('\n')),
-- calculado con el comando exacto:
-- node -e 'const c=require("crypto");const titulo="DECLARACIÓN JURADA DEL PARTICIPANTE — Declaro bajo mi responsabilidad que:";const items=["Me encuentro en condiciones físicas aptas para la actividad descrita. No tengo lesiones activas, enfermedades agudas ni condiciones de salud que comprometan mi seguridad o la del grupo.","He informado al líder de la actividad sobre mis condiciones de salud, medicamentos y alergias relevantes, a través de mi ficha de socio.","Cuento con el equipamiento mínimo exigido en la ficha técnica de esta actividad y sé utilizarlo correctamente.","Tengo la experiencia señalada en el protocolo correspondiente al nivel de esta actividad, y la he declarado con veracidad en mi ficha de experiencia.","Acepto y me comprometo a respetar las instrucciones del líder de la actividad en terreno, incluyendo la decisión de descenso preventivo si las condiciones lo ameritan.","Entiendo que el incumplimiento de cualquiera de los requisitos de este protocolo puede resultar en mi exclusión de la actividad, sin derecho a reembolso de costos ya incurridos.","Conozco los números de emergencia relevantes para la zona de la actividad y sé a quién llamar en caso de una emergencia."];console.log(c.createHash("sha256").update(titulo+"\n"+items.join("\n")).digest("hex"))'
INSERT INTO "declaracion_jurada_versiones" ("version", "titulo", "items", "hash_sha256")
VALUES (
  '2026-08',
  'DECLARACIÓN JURADA DEL PARTICIPANTE — Declaro bajo mi responsabilidad que:',
  '[
    "Me encuentro en condiciones físicas aptas para la actividad descrita. No tengo lesiones activas, enfermedades agudas ni condiciones de salud que comprometan mi seguridad o la del grupo.",
    "He informado al líder de la actividad sobre mis condiciones de salud, medicamentos y alergias relevantes, a través de mi ficha de socio.",
    "Cuento con el equipamiento mínimo exigido en la ficha técnica de esta actividad y sé utilizarlo correctamente.",
    "Tengo la experiencia señalada en el protocolo correspondiente al nivel de esta actividad, y la he declarado con veracidad en mi ficha de experiencia.",
    "Acepto y me comprometo a respetar las instrucciones del líder de la actividad en terreno, incluyendo la decisión de descenso preventivo si las condiciones lo ameritan.",
    "Entiendo que el incumplimiento de cualquiera de los requisitos de este protocolo puede resultar en mi exclusión de la actividad, sin derecho a reembolso de costos ya incurridos.",
    "Conozco los números de emergencia relevantes para la zona de la actividad y sé a quién llamar en caso de una emergencia."
  ]'::jsonb,
  '8f001039739a22d932b6fdce1ce55bbb945fe635547777b17a6e4c42d2fa37fc'
)
ON CONFLICT ("version") DO NOTHING;

-- Administrador de eventos del club
UPDATE "users" SET "rol" = 'ADMIN'
WHERE lower(email) = 'seguridad.acp.cl@gmail.com' AND "rol" <> 'ADMIN';
