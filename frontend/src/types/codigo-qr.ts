// ─── QR reusable del club ───────────────────────────────────────────────────
// Espejo de los tipos del backend (ver backend/src/services/codigos-qr.service.ts).
// A diferencia de una invitación individual (un enlace personal de un solo
// uso), este código se proyecta o imprime y cualquiera que lo escanee puede
// pedir su propia invitación SOCIO.

import type { Rol } from './invitacion'
import type { OrganizationBrand } from './salida'

export type QrDuracion = '2h' | '24h' | '7d'

export const QR_DURACION_LABELS: Record<QrDuracion, string> = {
  '2h': '2 horas',
  '24h': '24 horas',
  '7d': '7 días',
}

export type EstadoCodigoQr = 'ACTIVO' | 'EXPIRADO' | 'AGOTADO' | 'REVOCADO'

export const ESTADO_CODIGO_QR_LABELS: Record<EstadoCodigoQr, string> = {
  ACTIVO: 'Activo',
  EXPIRADO: 'Expirado',
  AGOTADO: 'Agotado',
  REVOCADO: 'Revocado',
}

// CORREO: el QR reusable de siempre (pide una invitación por email). DIRECTO:
// QR "de un solo uso" para un evento — quien lo escanea se registra en el
// momento, sin paso de correo.
export type ModoCodigoQr = 'CORREO' | 'DIRECTO'

export const MODO_CODIGO_QR_LABELS: Record<ModoCodigoQr, string> = {
  CORREO: 'Reutilizable',
  DIRECTO: 'Directo',
}

export interface CodigoQr {
  id: string
  etiqueta: string | null
  rol: Rol
  maxUsos: number
  usos: number
  usosRestantes: number
  expiresAt: string
  revocadoAt: string | null
  createdAt: string
  estado: EstadoCodigoQr
  creadoPor: { id: string; name: string } | null
  modo: ModoCodigoQr
  // Quién se registró con este código — solo puede ser no-null en uno DIRECTO
  // ya AGOTADO.
  registrado: { name: string; email: string } | null
}

// ─── Payloads de respuesta de la API ──────────────────────────────────────────

export interface CrearCodigoQrResponse {
  codigo: CodigoQr
  qrUrl: string
}

export interface ListarCodigosQrResponse {
  codigos: CodigoQr[]
}

export interface VerCodigoQrResponse {
  codigo: CodigoQr
  qrUrl: string
}

export interface RevocarCodigoQrResponse {
  codigo: CodigoQr
}

export interface EstadoCodigoQrResponse {
  estado: EstadoCodigoQr
  registrado: { name: string; email: string } | null
  expiresAt: string
}

export interface ConsultarCodigoQrResponse {
  organization: OrganizationBrand
  expiresAt: string
  modo: ModoCodigoQr
}

export interface SolicitarInvitacionQrResponse {
  message: string
}

export interface RegistrarConQrDirectoResponse {
  ok: true
}
