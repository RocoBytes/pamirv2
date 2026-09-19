-- CreateTable
CREATE TABLE "integrantes" (
    "id" TEXT NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "nacionalidad" TEXT NOT NULL,
    "genero" TEXT NOT NULL,
    "fecha_nacimiento" TIMESTAMP(3) NOT NULL,
    "direccion" TEXT NOT NULL,
    "comuna" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "telefono_celular" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "prevision_salud" TEXT NOT NULL,
    "nombre_contacto" TEXT NOT NULL,
    "parentesco" TEXT NOT NULL,
    "telefono_contacto" TEXT NOT NULL,
    "grupo_sanguineo" TEXT NOT NULL,
    "alergias_tiene" BOOLEAN NOT NULL,
    "alergias_detalle" TEXT,
    "enfermedades_cronicas_tiene" BOOLEAN NOT NULL,
    "enfermedades_cronicas_detalle" TEXT,
    "medicamentos_tiene" BOOLEAN NOT NULL,
    "medicamentos_detalle" TEXT,
    "cirugias_lesiones_tiene" BOOLEAN NOT NULL,
    "cirugias_lesiones_detalle" TEXT,
    "fuma" BOOLEAN NOT NULL,
    "usa_lentes" BOOLEAN NOT NULL,
    "declaracion_salud" BOOLEAN NOT NULL,
    "aceptacion_riesgo" BOOLEAN NOT NULL,
    "consentimiento_datos" BOOLEAN NOT NULL,
    "derecho_imagen" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrantes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integrantes_rut_key" ON "integrantes"("rut");
