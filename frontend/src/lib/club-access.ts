// Traduce el resultado de fetchMe() (ver hooks/useAuth.ts) al error de acceso
// a club que la Tabla de routing (Design §3) espera, sin ningún React de por
// medio — así se prueba con vitest puro, sin jsdom. Ver Ruling 1 y Ruling 5
// del plan de esta PR.
import { ApiError } from './api'

// Mensaje EXACTO que devuelve el backend para un club suspendido — ver
// CLUB_SUSPENDIDO_MENSAJE en backend/src/lib/organization-status.ts (fuente
// de verdad). Es la única comparación de texto de este archivo, y solo sirve
// para distinguir "suspendido" de "no soy socio" dentro del mismo status
// 403 — el message que termina viendo la UI sigue siendo el que mandó el
// backend, verbatim (Ruling 5: nunca un string propio del frontend).
export const CLUB_SUSPENDIDO_MENSAJE = 'El club está suspendido. Contacta al equipo de la plataforma.'

export interface ClubAccessError {
  status: 403 | 404
  message: string
  kind: 'no-encontrado' | 'no-socio' | 'suspendido'
}

// No-null solo cuando HAY un slug en el path (Ruling 1: sin slug, un 403/404
// sería inesperado y se prefiere no arriesgar un falso positivo) y el error
// es un ApiError 403 o 404 — cualquier otra cosa (401 "sesión expirada",
// 500/red, o un 403/404 sin slug) devuelve null, el mismo fallo silencioso
// de siempre.
export function deriveClubAccessError(slug: string | null, err: unknown): ClubAccessError | null {
  if (!slug) return null
  if (!(err instanceof ApiError)) return null
  if (err.status !== 403 && err.status !== 404) return null

  if (err.status === 404) {
    return { status: 404, message: err.message, kind: 'no-encontrado' }
  }

  const kind = err.message === CLUB_SUSPENDIDO_MENSAJE ? 'suspendido' : 'no-socio'
  return { status: 403, message: err.message, kind }
}
