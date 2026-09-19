-- Add alerta_enviada_at to salidas for cron alarm deduplication.
-- Tracks when the overdue alert email was sent so re-runs of the cron
-- do not send duplicate notifications for the same open salida.

ALTER TABLE "salidas" ADD COLUMN "alerta_enviada_at" TIMESTAMP(3);
