import { randomBytes, createHash } from 'crypto';
// Módulo puro (sin Prisma, sin I/O) con las reglas de negocio del sistema
// cerrado por invitación: quién puede invitar a quién, el ciclo de vida de
// una invitación y las etiquetas de rol. La orquestación (persistencia,
// envío de correo) vive en services/invitaciones.service.ts.
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Solo se persiste el hash SHA-256 del token (ver Invitacion.tokenHash en el
// schema); el valor en claro únicamente viaja en la URL enviada por correo.
export function generateInviteToken() {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: hashInviteToken(token) };
}
export function hashInviteToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
// Un LIDER es un SOCIO al que además se le permite invitar SOCIOS: no otorga
// ningún otro permiso. ADMIN puede invitar cualquier rol.
export function rolesInvitables(inviterRol) {
    if (inviterRol === 'ADMIN')
        return ['SOCIO', 'LIDER', 'ADMIN'];
    if (inviterRol === 'LIDER')
        return ['SOCIO'];
    return [];
}
export function puedeInvitarRol(inviterRol, targetRol) {
    return rolesInvitables(inviterRol).includes(targetRol);
}
// Precedencia: ACEPTADA > REVOCADA > EXPIRADA > PENDIENTE.
export function estadoInvitacion(inv, now) {
    if (inv.aceptadaAt)
        return 'ACEPTADA';
    if (inv.revocadaAt)
        return 'REVOCADA';
    if (inv.expiresAt <= now)
        return 'EXPIRADA';
    return 'PENDIENTE';
}
export const ROL_LABELS = {
    SOCIO: 'Socio',
    LIDER: 'Líder',
    ADMIN: 'Administrador',
};
// Nadie cambia su propio rol, lo que además garantiza que el sistema siempre
// conserva al menos un ADMIN (el requester).
export function puedeCambiarRol(requesterId, targetId) {
    return requesterId !== targetId;
}
