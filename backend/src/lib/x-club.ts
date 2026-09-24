// El club activo de cada request llega en el header X-Club (ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md) — el
// slug de uno de los clubes de los que la cuenta es socia. Separado de
// auth.middleware.ts (que lo consume para resolver req.user) y de
// auth.controller.ts (que también lo necesita para la marca del correo de
// forgotPassword) para no duplicar la lectura del header.
import type { Request } from 'express';

// Un header repetido llega como array en Express; se toma el primer valor,
// igual que el resto de los headers de una sola ocurrencia. Una cadena vacía
// o solo espacios se trata como "ausente": un X-Club: "" nunca debe
// intentar resolver un club con slug "".
export function xClubHeader(req: Pick<Request, 'headers'>): string | undefined {
  const raw = req.headers['x-club'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
