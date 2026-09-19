-- Evaluación express anónima post-cierre.
-- "evaluacion_respuestas" NO tiene FK ni columna hacia "evaluacion_tokens":
-- la respuesta queda desvinculada de la identidad del participante por diseño.
-- "used" es boolean (sin timestamp) para evitar correlación temporal con
-- "evaluacion_respuestas.created_at".

-- CreateTable
CREATE TABLE "evaluacion_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "salida_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluacion_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluacion_respuestas" (
    "id" TEXT NOT NULL,
    "salida_id" TEXT NOT NULL,
    "nota_objetivos" INTEGER NOT NULL,
    "nota_itinerario" INTEGER NOT NULL,
    "nota_lider" INTEGER NOT NULL,
    "comentario" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluacion_respuestas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluacion_tokens_token_key" ON "evaluacion_tokens"("token");

-- AddForeignKey
ALTER TABLE "evaluacion_tokens" ADD CONSTRAINT "evaluacion_tokens_salida_id_fkey" FOREIGN KEY ("salida_id") REFERENCES "salidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluacion_respuestas" ADD CONSTRAINT "evaluacion_respuestas_salida_id_fkey" FOREIGN KEY ("salida_id") REFERENCES "salidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
