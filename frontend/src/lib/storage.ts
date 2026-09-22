import type { SalidaFormData, AuthState, IntegranteRecord, User } from '../types/salida'

// Nombres de clave preservados a propósito, aunque ya no describan bien todo
// lo que guardan (p.ej. no son "de Pamir" en un sistema multi-club): renombrar
// alguna cerraría la sesión de todo el mundo y perdería borradores en vivo de
// gente en la montaña. pamir_owner es la única clave nueva de esta fase.
const KEYS = {
  AUTH: 'pamir_auth',
  DRAFT: 'pamir_draft',
  DRAFT_STEP: 'pamir_draft_step',
  INTEGRANTES: 'pamir_integrantes',
  OWNER: 'pamir_owner',
} as const

// Toda función acepta un Storage inyectado (default window.localStorage) para
// poder probarse sin jsdom, con un objeto en memoria como doble de prueba.
// El fallback a window.localStorage se resuelve DENTRO del try/catch de cada
// función (nunca en el valor por defecto del parámetro): auth-token.ts llama
// loadAuth() sin argumento al importarse, incluso fuera de un navegador (tests
// de otros módulos, SSR futuro), y un parámetro por defecto se evalúa antes
// de entrar a la función — un ReferenceError ahí no lo atraparía ningún catch.

function resolve(storage: Storage | undefined): Storage {
  // Si storage es undefined y tampoco hay window (import fuera de un
  // navegador, p.ej. un test de otro módulo), esto lanza a propósito: el
  // try/catch de cada función pública de este archivo lo atrapa.
  return storage ?? window.localStorage
}

// ─── Auth persistence ─────────────────────────────────────────────────────────

export function saveAuth(state: Pick<AuthState, 'user' | 'token'>, storage?: Storage): void {
  try {
    resolve(storage).setItem(KEYS.AUTH, JSON.stringify(state))
  } catch {
    // Storage might be full or unavailable
  }
}

export function loadAuth(storage?: Storage): Pick<AuthState, 'user' | 'token'> | null {
  try {
    const raw = resolve(storage).getItem(KEYS.AUTH)
    if (!raw) return null
    return JSON.parse(raw) as Pick<AuthState, 'user' | 'token'>
  } catch {
    return null
  }
}

export function clearAuth(storage?: Storage): void {
  try {
    resolve(storage).removeItem(KEYS.AUTH)
  } catch {
    // ignore
  }
}

// ─── Draft persistence ────────────────────────────────────────────────────────

export function saveDraft(data: Partial<Omit<SalidaFormData, 'gpxFile'>>, storage?: Storage): void {
  try {
    resolve(storage).setItem(KEYS.DRAFT, JSON.stringify(data))
  } catch {
    // Storage might be full
  }
}

export function saveDraftStep(step: number, storage?: Storage): void {
  try {
    resolve(storage).setItem(KEYS.DRAFT_STEP, String(step))
  } catch {
    // ignore
  }
}

export function loadDraft(storage?: Storage): Partial<Omit<SalidaFormData, 'gpxFile'>> | null {
  try {
    const raw = resolve(storage).getItem(KEYS.DRAFT)
    if (!raw) return null
    return JSON.parse(raw) as Partial<Omit<SalidaFormData, 'gpxFile'>>
  } catch {
    return null
  }
}

export function loadDraftStep(storage?: Storage): number {
  try {
    const raw = resolve(storage).getItem(KEYS.DRAFT_STEP)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return isNaN(n) ? 0 : n
  } catch {
    return 0
  }
}

export function clearDraft(storage?: Storage): void {
  try {
    const s = resolve(storage)
    s.removeItem(KEYS.DRAFT)
    s.removeItem(KEYS.DRAFT_STEP)
  } catch {
    // ignore
  }
}

// ─── Integrantes (registered club members) ───────────────────────────────────
// Nota: sin lector conocido en el resto del frontend (ver README) — se
// conserva porque purgarla en un cambio de dueño de sesión es parte del
// contrato de esta fase, no porque algo la consuma hoy.

export function saveIntegrante(integrante: IntegranteRecord, storage?: Storage): void {
  try {
    const s = resolve(storage)
    const existing = loadIntegrantes(s)
    const idx = existing.findIndex((i) => i.id === integrante.id)
    if (idx >= 0) {
      existing[idx] = integrante
    } else {
      existing.unshift(integrante)
    }
    s.setItem(KEYS.INTEGRANTES, JSON.stringify(existing))
  } catch {
    // ignore
  }
}

export function loadIntegrantes(storage?: Storage): IntegranteRecord[] {
  try {
    const raw = resolve(storage).getItem(KEYS.INTEGRANTES)
    if (!raw) return []
    return JSON.parse(raw) as IntegranteRecord[]
  } catch {
    return []
  }
}

export function clearIntegrantesCache(storage?: Storage): void {
  try {
    resolve(storage).removeItem(KEYS.INTEGRANTES)
  } catch {
    // ignore
  }
}

// ─── Draft ownership (un mismo navegador, más de un usuario) ─────────────────
// Un borrador de salida (o la caché de integrantes) pertenece a la última
// cuenta autenticada en este navegador, no a "quien esté usando el
// navegador". pamir_owner guarda ese id y se actualiza cada vez que se
// establece una sesión — login, el refresco de /me al montar la app, y el
// login automático tras aceptar una invitación (que reutiliza el mismo
// login) — siempre a través de establishSession, ANTES de sobrescribir
// pamir_auth. Cerrar sesión a propósito NO purga nada: ese es el
// comportamiento deseado (recargar en la montaña sin señal no debe perder la
// ficha en curso).

export type DraftOwnershipDecision = 'keep' | 'purge'

export function decideDraftOwnership(params: {
  storedOwnerId: string | null | undefined
  previousAuthUserId: string | null | undefined
  nextUserId: string
}): DraftOwnershipDecision {
  const { storedOwnerId, previousAuthUserId, nextUserId } = params
  if (storedOwnerId) {
    return storedOwnerId === nextUserId ? 'keep' : 'purge'
  }
  // Sin marca todavía (navegador que traía una versión anterior a
  // pamir_owner): se apoya en el último pamir_auth guardado en vez de purgar
  // a ciegas la primera vez que corre este código.
  return previousAuthUserId === nextUserId ? 'keep' : 'purge'
}

function loadOwnerId(storage: Storage): string | null {
  try {
    return storage.getItem(KEYS.OWNER)
  } catch {
    return null
  }
}

function saveOwnerId(userId: string, storage: Storage): void {
  try {
    storage.setItem(KEYS.OWNER, userId)
  } catch {
    // ignore
  }
}

export function establishSession(next: { user: User; token: string }, storage?: Storage): void {
  try {
    const s = resolve(storage)
    const previous = loadAuth(s)
    const decision = decideDraftOwnership({
      storedOwnerId: loadOwnerId(s),
      previousAuthUserId: previous?.user?.id,
      nextUserId: next.user.id,
    })
    if (decision === 'purge') {
      clearDraft(s)
      clearIntegrantesCache(s)
    }
    saveOwnerId(next.user.id, s)
    saveAuth(next, s)
  } catch {
    // Storage bloqueado (modo privado) o sin window: el login no debe romper
    // por esto — saveAuth/clearDraft ya son a prueba de fallos por su cuenta,
    // esto solo cubre resolve(storage) si window tampoco existiera.
  }
}
