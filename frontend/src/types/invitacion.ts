// ─── Sistema cerrado por invitación ───────────────────────────────────────────
// Espejo de los tipos del backend (ver backend/src/lib/invitaciones.ts y
// backend/src/services/invitaciones.service.ts). Un LIDER es un SOCIO al que
// además se le permite invitar SOCIOS; ADMIN puede invitar cualquier rol.

export type Rol = 'SOCIO' | 'LIDER' | 'ADMIN'

export const ROL_LABELS: Record<Rol, string> = {
  SOCIO: 'Socio',
  LIDER: 'Líder',
  ADMIN: 'Administrador',
}

export type EstadoInvitacion = 'PENDIENTE' | 'ACEPTADA' | 'REVOCADA' | 'EXPIRADA'

export const ESTADO_LABELS: Record<EstadoInvitacion, string> = {
  PENDIENTE: 'Pendiente',
  ACEPTADA: 'Aceptada',
  REVOCADA: 'Revocada',
  EXPIRADA: 'Expirada',
}

export interface Invitacion {
  id: string
  email: string
  rol: Rol
  estado: EstadoInvitacion
  expiresAt: string
  createdAt: string
  aceptadaAt: string | null
  revocadaAt: string | null
  invitadoPor: { id: string; name: string } | null
}

export interface UsuarioAdmin {
  id: string
  email: string
  name: string
  rol: Rol
  emailVerified: boolean
  createdAt: string
}

// ─── Payloads de respuesta de la API ──────────────────────────────────────────

export interface ConsultarInvitacionResponse {
  email: string
  rol: Rol
  rolLabel: string
  invitadoPor: string
}

export interface AceptarInvitacionResponse {
  message: string
  email: string
}

export interface CrearInvitacionResponse {
  invitacion: Invitacion
  inviteUrl: string
  emailEnviado: boolean
}

export interface ListarInvitacionesResponse {
  invitaciones: Invitacion[]
}
