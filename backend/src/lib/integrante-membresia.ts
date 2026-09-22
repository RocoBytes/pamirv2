// Regla de membresía para una ficha NUEVA: el formulario de registro
// pertenece al club donde se crea, así que nadie elige de qué club es socio
// — el servidor asigna siempre la membresía propia de ESE club y descarta
// cualquier `membresiaClub`/`nombreClub` que venga en el body (ver
// createIntegrante en integrantes.controller.ts). Función pura (sin Express
// ni Prisma) para poder probarla sin tocar la base de datos, igual que
// puedeVerDocumentos en documentos-access.ts.
export interface MembresiaParaNuevaFichaInput {
  organization: { membresiaPropia: string };
}

export interface MembresiaNuevaFicha {
  membresiaClub: string;
  nombreClub: null;
}

export function membresiaParaNuevaFicha({ organization }: MembresiaParaNuevaFichaInput): MembresiaNuevaFicha {
  return { membresiaClub: organization.membresiaPropia, nombreClub: null };
}
