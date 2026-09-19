export interface AuthUser {
  id: string;
  email: string;
  name: string;
  rol: 'SOCIO' | 'ADMIN';
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
