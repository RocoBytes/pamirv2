-- CreateEnum
CREATE TYPE "SalidaStatus" AS ENUM ('BORRADOR', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA', 'INCIDENTE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "picture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salidas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "tipo_salida" TEXT NOT NULL,
    "disciplina" TEXT NOT NULL,
    "nombre_actividad" TEXT NOT NULL,
    "ubicacion_geografica" TEXT NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_retorno_estimada" TIMESTAMP(3) NOT NULL,
    "hora_retorno_estimada" TEXT NOT NULL,
    "hora_alerta" TEXT NOT NULL,
    "avisos_externos" JSONB NOT NULL DEFAULT '[]',
    "lider_cordada" TEXT NOT NULL,
    "participantes" JSONB NOT NULL DEFAULT '[]',
    "coordinacion_grupal" BOOLEAN NOT NULL DEFAULT false,
    "matriz_riesgos" BOOLEAN NOT NULL DEFAULT false,
    "medios_comunicacion" JSONB NOT NULL DEFAULT '[]',
    "id_dispositivo_frecuencia" TEXT,
    "equipo_colectivo" JSONB NOT NULL DEFAULT '[]',
    "equipo_colectivo_otro" TEXT,
    "pronostico_meteorologico" TEXT,
    "riesgos_identificados" JSONB NOT NULL DEFAULT '[]',
    "riesgos_otro" TEXT,
    "plan_evacuacion" TEXT,
    "gpx_file_url" TEXT,
    "status" "SalidaStatus" NOT NULL DEFAULT 'BORRADOR',
    "incident_report" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salidas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "salidas" ADD CONSTRAINT "salidas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
