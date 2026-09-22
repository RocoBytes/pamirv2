import type { RolUsuario } from '../generated/prisma/client.js';

// Resumen del club del usuario autenticado, cargado una sola vez por request
// (ver authMiddleware) para que los controladores no vuelvan a consultar
// Organization cada vez que necesitan uno de estos datos.
export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  membresiaPropia: string;
  alertEmail: string;
  contactName: string;
  contactEmail: string;
}

export interface AuthUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  rol: RolUsuario;
  organization: OrganizationSummary;
}

// Augments Express's Request interface to add req.user
// Uses express-serve-static-core — the canonical extension point for @types/express
declare module 'express-serve-static-core' {
  interface Request {
    user: AuthUser | null;
    // Categorías de eventos que el usuario gestiona; null = acceso total (ADMIN).
    // Lo llena requireGestorEventos.
    gestorCategoriaIds?: number[] | null;
  }
}
