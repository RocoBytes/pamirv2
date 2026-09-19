-- CreateTable
CREATE TABLE "cierres" (
    "id" TEXT NOT NULL,
    "salida_id" TEXT NOT NULL,
    "user_id" TEXT,
    "fecha_finalizacion_real" TIMESTAMP(3) NOT NULL,
    "estado_cierre" TEXT NOT NULL,
    "motivo_abandono" TEXT,
    "hubo_cambios" TEXT NOT NULL,
    "motivos_cambios" JSONB NOT NULL DEFAULT '[]',
    "motivos_cambios_otro" TEXT,
    "ocurrio_incidente" TEXT NOT NULL,
    "tipos_incidente" JSONB NOT NULL DEFAULT '[]',
    "gravedad_lesion" TEXT,
    "descripcion_suceso" TEXT,
    "causas_raiz" JSONB NOT NULL DEFAULT '[]',
    "causa_raiz_otro" TEXT,
    "desempeno_equipo" TEXT NOT NULL,
    "detalle_falla_equipo" TEXT,
    "observaciones_ruta" TEXT NOT NULL,
    "precision_pronostico" INTEGER NOT NULL,
    "lecciones_aprendidas" TEXT NOT NULL,
    "recomendaciones_futuros" TEXT,
    "sugerencias_club" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cierres_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "cierres" ADD CONSTRAINT "cierres_salida_id_fkey" FOREIGN KEY ("salida_id") REFERENCES "salidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cierres" ADD CONSTRAINT "cierres_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
