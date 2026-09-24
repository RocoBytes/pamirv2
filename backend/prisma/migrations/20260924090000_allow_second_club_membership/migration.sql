-- Permite que la MISMA cuenta acepte más de una invitación (una por club) y
-- se registre por más de un QR directo (uno por club) — fase "Joining" del
-- diseño multi-club (docs/superpowers/specs/2026-09-23-multi-club-membership-design.md).
-- Antes de esta migración, invitaciones.usuario_id y
-- codigos_qr_invitacion.registrado_usuario_id eran @unique en TODA la tabla:
-- la segunda vez que la MISMA cuenta aceptaba una invitación o se registraba
-- por QR directo (en un club distinto) violaba esa unicidad con un error
-- crudo de Postgres en vez de una respuesta de servicio limpia — ver el plan
-- de esta PR, Ruling 1. Ninguna columna pierde su sentido: siguen
-- registrando "quién aceptó esta invitación / se registró con este código",
-- solo que ahora la misma persona puede aparecer en más de una fila (una por
-- club). Expand-only: no borra datos, y ningún código anterior a esta PR
-- intentó jamás reusar el mismo usuario_id/registrado_usuario_id dos veces
-- (todo código anterior bloqueaba con 409 una cuenta ya existente antes de
-- llegar a ese punto), así que el comportamiento no cambia para nada
-- anterior a esta PR — segura de revertir sin pérdida de datos.
DROP INDEX "invitaciones_usuario_id_key";
DROP INDEX "codigos_qr_invitacion_registrado_usuario_id_key";
