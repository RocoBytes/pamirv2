// Separado del resto de la lógica de auth (middleware y controller la
// comparten) para poder probarla sin tocar la base de datos y para que ningún
// archivo dependa del otro solo por este criterio.
import type { OrganizationStatus } from '../generated/prisma/client.js';

export function isOrganizationSuspended(status: OrganizationStatus): boolean {
  return status === 'SUSPENDED';
}

export const CLUB_SUSPENDIDO_MENSAJE = 'El club está suspendido. Contacta al equipo de la plataforma.';
