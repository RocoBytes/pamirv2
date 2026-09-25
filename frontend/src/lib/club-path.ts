// El primer segmento del path es el club (riala.cl/<slug>) — ver
// docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
// Separado de club-preferido.ts (ya no gobierna ninguna marca del login desde
// la Decisión del 2026-09-25 — login único, siempre con marca RIALA — pero el
// archivo se deja intacto: recordarClub() sigue escribiendo desde
// storage.ts): este archivo resuelve el club ACTIVO de la sesión, la fuente
// que api.ts usa para el header X-Club y que App.tsx usa para decidir qué
// pantalla mostrar.
import { SLUG_PATTERN } from './club-brand'
import { parseInviteToken, parseQrToken } from './invite-token'

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
  // 'riala' NO va acá aunque SLUGS_RESERVADOS del backend lo incluya: allá
  // impide CREAR otro club con ese slug, pero `riala` es el club casa, un
  // club real que se abre en /riala. Tratarlo como ruta reservada dejaba a
  // sus socios en un bucle de redirección infinito (/ → /riala → /).
  'assets',
  'auth',
  'brand',
])

// 2..40 caracteres, igual que validarSlug en backend/src/scripts/tenant-args.ts
// (la fuente de verdad): un club real nunca tiene un slug fuera de ese rango,
// así que un segmento de 1 char o larguísimo que cumpliera SLUG_PATTERN nunca
// debe tratarse como club ni viajar en el header X-Club de api.ts.
function isClubSlug(value: string): boolean {
  return (
    value.length >= 2 &&
    value.length <= 40 &&
    SLUG_PATTERN.test(value) &&
    !RESERVED_TOP_LEVEL_SLUGS.has(value)
  )
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

interface RedirectSignedOutClubPathParams {
  pathname?: string
  hash?: string
  // Inyectado (en vez de leer localStorage/sessionStorage acá) para que este
  // archivo siga sin depender de lib/storage.ts y quede testeable puro, igual
  // que el resto de las funciones de este archivo — App.tsx es quien decide
  // "hay sesión guardada" vía loadAuth() antes de llamar a esto.
  hasSession?: boolean
  replace?: (path: string) => void
}

// Decisión del 2026-09-25 (login único): SIN sesión guardada, riala.cl/<lo
// que sea> — un slug válido, uno desconocido, o una ruta reservada, todos por
// igual — vuelve a riala.cl/ para el login único con marca RIALA. Nunca pinta
// el logo de un club antes de autenticar, y la pantalla de "Club no
// encontrado" sin sesión (que antes vivía en AuthPage) queda inalcanzable a
// propósito. Excepción única: un token de invitación o QR pendiente en el
// fragmento (#invite=/#qr=) — esas dos pantallas siguen funcionando en
// cualquier path, con la marca del club que invita. Se corre a nivel de
// módulo en App.tsx, antes del primer render (mismo momento que
// redirectLegacyClubQueryParam, después de esa reescritura), para que nunca
// llegue a pintarse ni un solo frame con la URL vieja.
export function redirectSignedOutClubPath(params: RedirectSignedOutClubPathParams = {}): void {
  try {
    if (params.hasSession) return
    const pathname = params.pathname ?? window.location.pathname
    if (pathname === '/') return
    const hash = params.hash ?? window.location.hash
    if (parseInviteToken(hash) || parseQrToken(hash)) return
    const replace = params.replace ?? ((path: string) => window.location.replace(path))
    replace('/')
  } catch {
    // Sin window, o storage/URL bloqueados: nunca debe romper el arranque de
    // la app — mismo criterio que el resto de este archivo.
  }
}

// ¿La cuenta puede abrir HOY el club de este slug? (es socia de él, y esa
// membresía no está suspendida). Puro y sin window a propósito: lo comparte
// App.tsx (gatea la migración del draft sin club — nunca mover un borrador a
// un club ajeno, un typo en la URL, o un club suspendido, donde quedaría
// escondido sin que nadie pueda verlo ni recuperarlo) y este mismo test.
// `clubes` null/undefined es "todavía no se sabe" (Ruling 3), nunca "no
// tiene ninguno": devuelve false igual que un slug que no aparece en la
// lista, nunca lanza ni asume.
export function puedeAbrirClub(
  slug: string | null,
  clubes: { slug: string; suspendido: boolean }[] | null | undefined,
): boolean {
  if (!slug || !clubes) return false
  const membresia = clubes.find((c) => c.slug === slug)
  return !!membresia && !membresia.suspendido
}
