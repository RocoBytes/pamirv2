import { randomBytes, createHash } from 'crypto';
import type { RolUsuario } from '../generated/prisma/client.js';

// Módulo puro (sin Prisma, sin I/O) con las reglas de negocio del sistema
// cerrado por invitación: quién puede invitar a quién, el ciclo de vida de
// una invitación y las etiquetas de rol. La orquestación (persistencia,
// envío de correo) vive en services/invitaciones.service.ts.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Solo se persiste el hash SHA-256 del token (ver Invitacion.tokenHash en el
// schema); el valor en claro únicamente viaja en la URL enviada por correo.
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Un LIDER es un SOCIO al que además se le permite invitar SOCIOS: no otorga
// ningún otro permiso. ADMIN puede invitar cualquier rol.
export function rolesInvitables(inviterRol: string): RolUsuario[] {
  if (inviterRol === 'ADMIN') return ['SOCIO', 'LIDER', 'ADMIN'];
  if (inviterRol === 'LIDER') return ['SOCIO'];
  return [];
}

export function puedeInvitarRol(inviterRol: string, targetRol: string): boolean {
  return (rolesInvitables(inviterRol) as string[]).includes(targetRol);
}

export type EstadoInvitacion = 'PENDIENTE' | 'ACEPTADA' | 'REVOCADA' | 'EXPIRADA';

interface InvitacionEstadoInput {
  aceptadaAt: Date | null;
  revocadaAt: Date | null;
  expiresAt: Date;
}

// Precedencia: ACEPTADA > REVOCADA > EXPIRADA > PENDIENTE.
export function estadoInvitacion(inv: InvitacionEstadoInput, now: Date): EstadoInvitacion {
  if (inv.aceptadaAt) return 'ACEPTADA';
  if (inv.revocadaAt) return 'REVOCADA';
  if (inv.expiresAt <= now) return 'EXPIRADA';
  return 'PENDIENTE';
}

export const ROL_LABELS: Record<RolUsuario, string> = {
  SOCIO: 'Socio',
  LIDER: 'Líder',
  ADMIN: 'Administrador',
};

// Nadie cambia su propio rol, lo que además garantiza que el sistema siempre
// conserva al menos un ADMIN (el requester).
export function puedeCambiarRol(requesterId: string, targetId: string): boolean {
  return requesterId !== targetId;
}
