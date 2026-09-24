// Elige el club cuya marca (nombre, contacto) usa el correo de
// restablecimiento de contraseña, ahora que una cuenta puede pertenecer a
// varios clubes — ver diseño multi-club §2 "Password reset". Puro: recibe
// las membresías ya cargadas (ordenadas por antigüedad) y el id del club de
// la request, si lo hay; no toca Prisma ni Express.
export interface MembresiaParaBranding {
  organizationId: string;
}

// `memberships` debe venir ordenado por creadoAt ascendente: el primero es
// "la más antigua". `requestOrganizationId` es el club resuelto del header
// X-Club de la request (null si no vino, o si no existe ningún club con ese
// slug) — se usa solo si la persona es efectivamente socia de él.
export function resolveResetBrandingOrganizationId(
  memberships: MembresiaParaBranding[],
  requestOrganizationId: string | null,
): string | null {
  if (requestOrganizationId && memberships.some((m) => m.organizationId === requestOrganizationId)) {
    return requestOrganizationId;
  }
  return memberships[0]?.organizationId ?? null;
}
