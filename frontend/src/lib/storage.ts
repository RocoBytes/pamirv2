import type { SalidaFormData, AuthState, IntegranteRecord, User } from '../types/salida'
import { recordarClub } from './club-preferido'

// Nombres de clave preservados a propósito, aunque ya no describan bien todo
// lo que guardan (p.ej. no son "de Pamir" en un sistema multi-club): renombrar
// alguna cerraría la sesión de todo el mundo y perdería borradores en vivo de
// gente en la montaña. pamir_owner es la única clave nueva de esta fase.
//
// DRAFT/DRAFT_STEP/INTEGRANTES son BASES: la clave real agrega ":<slug>"
// cuando se pasa un club (ver draftKey/draftStepKey/integrantesKey abajo).
// pamir_auth y pamir_owner siguen siendo únicos por navegador, sin club — la
// sesión y su dueño no son datos de un club, son datos de la persona.
const KEYS = {
  AUTH: 'pamir_auth',
  DRAFT: 'pamir_draft',
  DRAFT_STEP: 'pamir_draft_step',
  INTEGRANTES: 'pamir_integrantes',
  OWNER: 'pamir_owner',
} as const

// Sin slug, la clave de siempre (compatibilidad hacia atrás: una sesión ya
// abierta antes de esta fase, o cualquier caller que todavía no pasa club).
function draftKey(clubSlug?: string): string {
  return clubSlug ? `${KEYS.DRAFT}:${clubSlug}` : KEYS.DRAFT
}

function draftStepKey(clubSlug?: string): string {
  return clubSlug ? `${KEYS.DRAFT_STEP}:${clubSlug}` : KEYS.DRAFT_STEP
}

function integrantesKey(clubSlug?: string): string {
  return clubSlug ? `${KEYS.INTEGRANTES}:${clubSlug}` : KEYS.INTEGRANTES
}

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
// El registro de auth (KEYS.AUTH) es la única clave de este archivo que vive
// en DOS storages posibles: localStorage cuando el usuario marca "recordar
// este equipo" (sobrevive a cerrar el navegador) y sessionStorage cuando no
// (muere con la pestaña). Todo lo demás — borrador, integrantes, pamir_owner,
// club recordado — sigue SIEMPRE en localStorage; ver establishSession más
// abajo, que es el único punto que decide en cuál de los dos escribir.
//
// saveAuth/loadAuth/clearAuth conservan el patrón de un único Storage
// inyectado para cuando de verdad se quiere operar sobre uno exacto (p.ej.
// "el que se eligió"). Sin argumento, loadAuth/clearAuth operan sobre el PAR
// real del navegador (sessionStorage primero, localStorage como respaldo) en
// vez de uno solo — y para poder probar ese camino sin jsdom, también
// aceptan el par inyectado en vez de un Storage suelto.

export interface AuthStoragePair {
  session: Storage
  local: Storage
}

// Storage real (con o sin jsdom) siempre expone getItem; el par {session,
// local} nunca lo tiene en ese nivel. Discrimina en runtime, no solo en el
// tipo, porque lib.dom tipa Storage con un índice `[name: string]: any` que
// haría a `'session' in valor` ambiguo como guarda de tipos.
function isStoragePair(value: Storage | AuthStoragePair): value is AuthStoragePair {
  return typeof (value as Storage).getItem !== 'function'
}

function windowAuthPair(): AuthStoragePair {
  return { session: window.sessionStorage, local: window.localStorage }
}

export function saveAuth(state: Pick<AuthState, 'user' | 'token'>, storage?: Storage): void {
  try {
    resolve(storage).setItem(KEYS.AUTH, JSON.stringify(state))
  } catch {
    // Storage might be full or unavailable
  }
}

export function loadAuth(storage?: Storage | AuthStoragePair): Pick<AuthState, 'user' | 'token'> | null {
  try {
    const target = storage === undefined ? windowAuthPair() : storage
    if (isStoragePair(target)) {
      const fromSession = target.session.getItem(KEYS.AUTH)
      if (fromSession) return JSON.parse(fromSession) as Pick<AuthState, 'user' | 'token'>
      const fromLocal = target.local.getItem(KEYS.AUTH)
      if (!fromLocal) return null
      return JSON.parse(fromLocal) as Pick<AuthState, 'user' | 'token'>
    }
    const raw = target.getItem(KEYS.AUTH)
    if (!raw) return null
    return JSON.parse(raw) as Pick<AuthState, 'user' | 'token'>
  } catch {
    return null
  }
}

export function clearAuth(storage?: Storage | AuthStoragePair): void {
  try {
    const target = storage === undefined ? windowAuthPair() : storage
    if (isStoragePair(target)) {
      target.session.removeItem(KEYS.AUTH)
      target.local.removeItem(KEYS.AUTH)
      return
    }
    target.removeItem(KEYS.AUTH)
  } catch {
    // ignore
  }
}

// true si el registro de auth vigente vive en localStorage (o si no hay
// ninguno todavía — "recordado" es el valor por defecto), false si vive en
// sessionStorage. Deja que un refresco de sesión (fetchMe al montar,
// refreshSession) reescriba pamir_auth sin cambiarlo de storage a espaldas
// de la marca "recordar este equipo" que el usuario ya eligió al iniciar
// sesión — ver useAuth.ts.
export function isAuthRemembered(pair?: AuthStoragePair): boolean {
  try {
    const { session } = pair ?? windowAuthPair()
    return !session.getItem(KEYS.AUTH)
  } catch {
    return true
  }
}

// ─── Draft persistence ────────────────────────────────────────────────────────

export function saveDraft(
  data: Partial<Omit<SalidaFormData, 'gpxFile'>>,
  storage?: Storage,
  clubSlug?: string,
): void {
  try {
    resolve(storage).setItem(draftKey(clubSlug), JSON.stringify(data))
  } catch {
    // Storage might be full
  }
}

export function saveDraftStep(step: number, storage?: Storage, clubSlug?: string): void {
  try {
    resolve(storage).setItem(draftStepKey(clubSlug), String(step))
  } catch {
    // ignore
  }
}

export function loadDraft(
  storage?: Storage,
  clubSlug?: string,
): Partial<Omit<SalidaFormData, 'gpxFile'>> | null {
  try {
    const raw = resolve(storage).getItem(draftKey(clubSlug))
    if (!raw) return null
    return JSON.parse(raw) as Partial<Omit<SalidaFormData, 'gpxFile'>>
  } catch {
    return null
  }
}

export function loadDraftStep(storage?: Storage, clubSlug?: string): number {
  try {
    const raw = resolve(storage).getItem(draftStepKey(clubSlug))
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return isNaN(n) ? 0 : n
  } catch {
    return 0
  }
}

export function clearDraft(storage?: Storage, clubSlug?: string): void {
  try {
    const s = resolve(storage)
    s.removeItem(draftKey(clubSlug))
    s.removeItem(draftStepKey(clubSlug))
  } catch {
    // ignore
  }
}

// Migración de una sola vez: un draft guardado ANTES de esta fase vive en la
// clave sin club (pamir_draft). Al primer load posterior al release, se
// asigna al club ACTUAL — nadie pierde una ficha que estaba llenando en la
// montaña. Nunca pisa un draft que YA exista en la clave del club actual (si
// alguien ya empezó de cero ahí, ese draft gana), y nunca borra el draft sin
// club si el destino está ocupado — se queda huérfano mejor que perderse (un
// caso raro: dos sesiones/pestañas distintas en el mismo navegador, una
// vieja y una ya migrada). Sin slug (raíz del dominio, sin club activo) es
// un no-op: no hay clave de club a la cual migrar todavía.
export function migrateUnkeyedDraftToCurrentClub(storage?: Storage, clubSlug?: string): void {
  if (!clubSlug) return
  try {
    const s = resolve(storage)
    const legacy = s.getItem(KEYS.DRAFT)
    if (!legacy) return
    if (s.getItem(draftKey(clubSlug)) !== null) return

    s.setItem(draftKey(clubSlug), legacy)
    const legacyStep = s.getItem(KEYS.DRAFT_STEP)
    if (legacyStep !== null) s.setItem(draftStepKey(clubSlug), legacyStep)

    s.removeItem(KEYS.DRAFT)
    s.removeItem(KEYS.DRAFT_STEP)
  } catch {
    // Storage bloqueado: la migración es una conveniencia, nunca debe romper
    // el arranque de la app.
  }
}

// ─── Integrantes (registered club members) ───────────────────────────────────
// Nota: sin lector conocido en el resto del frontend (ver README) — se
// conserva porque purgarla en un cambio de dueño de sesión es parte del
// contrato de esta fase, no porque algo la consuma hoy.

export function saveIntegrante(integrante: IntegranteRecord, storage?: Storage, clubSlug?: string): void {
  try {
    const s = resolve(storage)
    const existing = loadIntegrantes(s, clubSlug)
    const idx = existing.findIndex((i) => i.id === integrante.id)
    if (idx >= 0) {
      existing[idx] = integrante
    } else {
      existing.unshift(integrante)
    }
    s.setItem(integrantesKey(clubSlug), JSON.stringify(existing))
  } catch {
    // ignore
  }
}

export function loadIntegrantes(storage?: Storage, clubSlug?: string): IntegranteRecord[] {
  try {
    const raw = resolve(storage).getItem(integrantesKey(clubSlug))
    if (!raw) return []
    return JSON.parse(raw) as IntegranteRecord[]
  } catch {
    return []
  }
}

export function clearIntegrantesCache(storage?: Storage, clubSlug?: string): void {
  try {
    resolve(storage).removeItem(integrantesKey(clubSlug))
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

export interface EstablishSessionOptions {
  /**
   * true (por defecto) = localStorage ("recordar este equipo"), false =
   * sessionStorage (muere al cerrar el navegador). Solo mueve el registro de
   * auth — borrador, integrantes, pamir_owner y club recordado siguen
   * SIEMPRE en `local`, sin importar este flag.
   */
  remember?: boolean
  local?: Storage
  session?: Storage
}

export function establishSession(next: { user: User; token: string }, options?: EstablishSessionOptions): void {
  try {
    const remember = options?.remember ?? true
    const local = options?.local ?? window.localStorage
    const session = options?.session ?? window.sessionStorage
    const chosen = remember ? local : session
    const other = remember ? session : local

    const previous = loadAuth({ session, local })
    const decision = decideDraftOwnership({
      storedOwnerId: loadOwnerId(local),
      previousAuthUserId: previous?.user?.id,
      nextUserId: next.user.id,
    })
    if (decision === 'purge') {
      clearDraft(local)
      clearIntegrantesCache(local)
    }
    saveOwnerId(next.user.id, local)
    saveAuth(next, chosen)
    // El registro puede haber quedado en el OTRO storage por una sesión
    // anterior (p.ej. "no recordar" seguido de "recordar" en el mismo
    // navegador): se borra para que nunca convivan dos registros de auth.
    clearAuth(other)
    // Gobierna solo la marca del login (ver club-preferido.ts) — nunca el
    // acceso a datos. Sesiones viejas sin organization aún no resuelto por
    // /me simplemente no tocan el club recordado.
    if (next.user.organization?.slug) {
      recordarClub(next.user.organization.slug, local)
    }
  } catch {
    // Storage bloqueado (modo privado) o sin window: el login no debe romper
    // por esto.
  }
}
