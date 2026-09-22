-- Invitaciones emitidas por la plataforma: las usa el alta de un club para su
-- primer ADMIN, que no tiene invitador. Quedan exentas de la regla "el
-- invitador debe conservar la autoridad para otorgar ese rol".

-- AlterTable
ALTER TABLE "invitaciones" ADD COLUMN     "emitida_por_plataforma" BOOLEAN NOT NULL DEFAULT false;
