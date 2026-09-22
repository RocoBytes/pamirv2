// Regla de acceso a la biblioteca de documentos del club, extraída como
// función pura (sin Prisma, sin Express) para poder probarla sin tocar la
// base de datos. El admin siempre pasa; cualquier otra persona necesita una
// ficha de Integrante cuya membresía coincida con la membresía propia del
// club (Organization.membresiaPropia) — ver getDocumentos en
// documentos.controller.ts.
export interface PuedeVerDocumentosInput {
  isAdmin: boolean;
  integranteMembresiaClub: string | null | undefined;
  membresiaPropia: string;
}

export function puedeVerDocumentos({
  isAdmin,
  integranteMembresiaClub,
  membresiaPropia,
}: PuedeVerDocumentosInput): boolean {
  return isAdmin || integranteMembresiaClub === membresiaPropia;
}
