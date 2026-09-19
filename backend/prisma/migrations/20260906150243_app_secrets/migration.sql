-- Secretos rotables desde el panel de administración.
-- El primero es el refresh token de Google: con la pantalla de consentimiento
-- OAuth en estado "Testing", Google lo caduca cada 7 días, y hasta ahora
-- renovarlo exigía SSH al VPS, editar /opt/pamir/.env y recrear el contenedor.
-- `value` se guarda cifrado (AES-256-GCM), nunca en claro.
CREATE TABLE "app_secrets" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_secrets_key_key" ON "app_secrets"("key");
