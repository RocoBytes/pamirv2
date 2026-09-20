// Autorización de administrador basada en el rol persistido en la base de
// datos (columna `rol` de User), nunca en el email. `authMiddleware` recarga
// el usuario en cada request, así que `req.user.rol` siempre refleja el valor
// actual — promover o degradar un admin es un UPDATE en la base, sin redeploy.
export function isAdmin(user: { rol?: string | null } | null | undefined): boolean {
  return user?.rol === 'ADMIN';
}
