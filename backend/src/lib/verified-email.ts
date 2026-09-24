// Decodifica y VERIFICA (nunca solo decodifica) el header Authorization en un
// email de cuenta, o null si no hay uno válido — usado por los endpoints
// públicos de "unirse con una cuenta existente" (aceptarInvitacion,
// registrarConQrDirecto) como prueba alternativa a la contraseña: ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md y el plan
// de esta PR (Ruling 3). Deliberadamente separado de auth.middleware.ts: esos
// dos endpoints son públicos (nunca pasan por authMiddleware, ni deben — la
// persona todavía no es socia del club al que se está uniendo), así que este
// helper nunca resuelve membresías ni club activo, solo el email verificado
// del propio JWT.
import type { Request } from 'express';
import { verifyToken } from './jwt.js';

export function verifiedEmailFromAuthHeader(req: Pick<Request, 'headers'>): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;

  try {
    return verifyToken(header.slice(7)).email;
  } catch {
    // Token ausente, mal formado, expirado o con firma inválida: se trata
    // igual que "no se envió Bearer" — el llamador cae a la prueba por
    // contraseña, nunca revienta el endpoint público.
    return null;
  }
}
