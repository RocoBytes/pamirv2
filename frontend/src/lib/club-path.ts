// El primer segmento del path es el club (riala.cl/<slug>) — ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
// Separado de club-preferido.ts (que sigue gobernando SOLO la marca del login
// en la raíz sin sesión, vía ?club= o el club recordado): este archivo
// resuelve el club ACTIVO de la sesión, la fuente que api.ts usa para el
// header X-Club y que App.tsx usa para decidir qué pantalla mostrar.
import { SLUG_PATTERN } from './club-brand'

// Rutas de nivel superior reservadas por el frontend multi-club — debe
// coincidir exactamente con SLUGS_RESERVADOS en
// backend/src/scripts/tenant-args.ts (la fuente de verdad: tenant:create y
// tenant:update ya rechazan estos slugs para cualquier club real). Un valor
// que cumple SLUG_PATTERN pero está en esta lista NUNCA es el slug de un
// club — evita que /assets, /auth, /brand, /api, /platform, /plataforma,
// /admin, /www, /app o /riala se interpreten como un club y terminen en el
// header X-Club de api.ts.
const RESERVED_TOP_LEVEL_SLUGS = new Set([
  'platform',
  'plataforma',
  'admin',
  'api',
  'www',
  'app',
  'riala',
  'assets',
  'auth',
  'brand',
])

function isClubSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && !RESERVED_TOP_LEVEL_SLUGS.has(value)
}

// pathname es inyectable (mismo criterio que storage.ts/club-preferido.ts,
// para poder probar esto sin window) y se resuelve DENTRO del try/catch,
// nunca en el valor por defecto del parámetro.
export function clubSlugFromPath(pathname?: string): string | null {
  try {
    const raw = pathname ?? window.location.pathname
    const first = raw.split('/').find((segment) => segment.length > 0)
    return first && isClubSlug(first) ? first : null
  } catch {
    return null
  }
}

interface RedirectLegacyClubQueryParamParams {
  search?: string
  pathname?: string
  hash?: string
  replaceState?: (path: string) => void
}

// Enlaces viejos de la forma riala.cl/?club=<slug> (antes de esta fase, solo
// gobernaban el branding del login) pasan a redirigir a riala.cl/<slug> — sin
// perder ningún otro parámetro de la URL ni el fragmento (un token de
// invitación/QR en el hash, que nunca se loguea acá ni en ningún otro lado).
// Nunca toca una URL que YA trae un slug en el path: evita un loop y evita
// pisar /<slug>?club=<otro>, que no debería existir pero no se asume.
export function redirectLegacyClubQueryParam(params: RedirectLegacyClubQueryParamParams = {}): void {
  try {
    const search = params.search ?? window.location.search
    const pathname = params.pathname ?? window.location.pathname
    if (clubSlugFromPath(pathname)) return

    const query = new URLSearchParams(search)
    const raw = query.get('club')
    if (!raw || !isClubSlug(raw)) return

    query.delete('club')
    const rest = query.toString()
    const hash = params.hash ?? window.location.hash
    const target = `/${raw}${rest ? `?${rest}` : ''}${hash || ''}`
    const replaceState = params.replaceState ?? ((path: string) => window.history.replaceState(null, '', path))
    replaceState(target)
  } catch {
    // Sin window, o storage/URL bloqueados: la redirección de un link legacy
    // es solo una conveniencia, nunca debe romper el arranque de la app.
  }
}
