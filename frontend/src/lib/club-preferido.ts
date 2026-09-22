// Club preferido para pintar la marca ANTES de iniciar sesión (login,
// AuthPage): resuelve slug de la URL o del último club con el que se inició
// sesión en este navegador. Gobierna SOLO la marca (logo/nombre) — nunca el
// acceso a datos, que sigue decidiendo el JWT (ver AuthPage.tsx y
// establishSession en storage.ts, que llama recordarClub al iniciar sesión).
import { SLUG_PATTERN } from './club-brand'

const KEY = 'pamir_club_preferido'

// search/storage son inyectables (mismo criterio que storage.ts) para poder
// probar esto sin window/jsdom. Por defecto, window.location.search /
// window.localStorage — resueltos DENTRO del try/catch, nunca en el valor
// por defecto de un parámetro, que se evalúa antes de entrar a la función y
// no lo atraparía ningún catch.

// ?club=<slug> en la URL: nunca se confía en el valor crudo, se valida contra
// el mismo patrón que clubLogoSrc.
export function clubDesdeUrl(search?: string): string | null {
  try {
    const raw = new URLSearchParams(search ?? window.location.search).get('club')
    return raw && SLUG_PATTERN.test(raw) ? raw : null
  } catch {
    return null
  }
}

export function clubRecordado(storage?: Storage): string | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(KEY)
    return raw && SLUG_PATTERN.test(raw) ? raw : null
  } catch {
    return null
  }
}

export function recordarClub(slug: string, storage?: Storage): void {
  try {
    if (!SLUG_PATTERN.test(slug)) return
    ;(storage ?? window.localStorage).setItem(KEY, slug)
  } catch {
    // Storage bloqueado (modo privado) o sin window: recordar el club es
    // solo una conveniencia de branding, nunca debe romper el login.
  }
}

// URL gana sobre lo recordado: alguien que abre ?club=<otro> a propósito
// (compartir el link del club correcto) no debe seguir viendo el último club
// con el que inició sesión en este navegador.
export function clubPreferido(params?: { search?: string; storage?: Storage }): string | null {
  return clubDesdeUrl(params?.search) ?? clubRecordado(params?.storage)
}
