// Autorización de administrador basada en el rol persistido en la base de
// datos (columna `rol` de User), nunca en el email. `authMiddleware` recarga
// el usuario en cada request, así que `req.user.rol` siempre refleja el valor
// actual — promover o degradar un admin es un UPDATE en la base, sin redeploy.
export function isAdmin(user) {
    return user?.rol === 'ADMIN';
}
// Un LIDER es un SOCIO al que además se le permite invitar SOCIOS: no otorga
// ningún otro permiso en el resto de la aplicación (ver lib/invitaciones.ts
// para el detalle de qué rol puede invitar a cuál).
export function canInvite(user) {
    return user?.rol === 'ADMIN' || user?.rol === 'LIDER';
}
