-- Biblioteca de documentos del club, visible solo para socios ACP y admin.
-- Los archivos viven en Google Drive (drive_file_id / drive_file_url);
-- "visible" permite preparar documentos sin publicarlos.

-- CreateTable
CREATE TABLE "documentos" (
    "id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "drive_file_id" TEXT,
    "drive_file_url" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);
