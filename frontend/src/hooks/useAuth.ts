import { useState, useCallback, useEffect } from 'react'
import type { User, AuthState } from '../types/salida'
import { establishSession, loadAuth, clearAuth, isAuthRemembered } from '../lib/storage'
import { setAuthToken } from '../lib/auth-token'
import { loginWithCredentials, fetchMe } from '../lib/api'
import { clubSlugFromPath } from '../lib/club-path'
import { deriveClubAccessError, type ClubAccessError } from '../lib/club-access'

interface UseAuthReturn extends AuthState {
  // remember: true guarda la sesión en localStorage ("recordar este
  // equipo"); false, en sessionStorage (muere al cerrar el navegador). Ver
  // establishSession en storage.ts.
  loginWithCredentials: (email: string, password: string, remember: boolean) => Promise<void>
  logout: () => void
  // Vuelve a pedir /me y actualiza la sesión (y pamir_auth) con lo que
  // responda el servidor. Usado por ClubBrandingAdminSection tras subir o
  // quitar el logo propio del club, para que hasLogo/logoVersion lleguen
  // frescos a toda la app (la cabecera incluida) sin recargar la página. No
  // hace nada sin sesión; propaga el error de red para que quien la llame
  // decida cómo mostrarlo (o ignorarlo, como hace el efecto de montaje).
  refreshSession: () => Promise<void>
  // No-null solo cuando el club de la URL (ver lib/club-path.ts) existe pero
  // el backend acaba de rechazar la cuenta activa para ese club — 403 "no
  // soy socio", 403 suspendido o 404 "club no encontrado" (kind distingue
  // los dos 403 entre sí, ver lib/club-access.ts). App.tsx lo usa para
  // decidir entre el dashboard y una de las pantallas de la Tabla de routing
  // (Design §3). Nunca se llena por un error SIN slug en el path (Ruling 1
  // del plan de esta PR: ahí el comportamiento sigue siendo el silencioso de
  // siempre).
  clubAccessError: ClubAccessError | null
  // false solo durante la ventana entre "hay una sesión guardada" y "el /me
  // de montaje para ESTE path ya resolvió (éxito o error)". El resto del
  // tiempo (sin sesión guardada, tras un login fresco, o una vez la
  // verificación de montaje se asentó) es true: `user` refleja datos
  // confirmados por el servidor, no solo lo cacheado en pamir_auth. App.tsx
  // lo usa para no decidir nada sensible al club (p.ej. migrar el borrador
  // sin club) contra `clubes` todavía no verificado — ver Ruling del
  // round 2 de review de esta PR.
  sessionChecked: boolean
}

function buildInitialState(): { user: User | null; token: string | null } {
  const saved = loadAuth()
  if (!saved) return { user: null, token: null }
  return {
    user: saved.user,
    token: saved.token,
  }
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState(buildInitialState)
  const [isLoading, setIsLoading] = useState(false)
  const [clubAccessError, setClubAccessError] = useState<ClubAccessError | null>(null)
  // Arranca en false SOLO cuando hay una sesión guardada con token (algo que
  // efectivamente hay que verificar contra el servidor); sin sesión no hay
  // nada que esperar. Ver el efecto de montaje más abajo, que lo asienta en
  // true apenas fetchMe() resuelve (éxito o error) — o de inmediato en el
  // único caso donde Ruling 2 decide NO llamarlo (bare domain, 2+
  // membresías ya conocidas: ahí "Mis clubes" confía en el caché a
  // propósito, es una decisión aparte de esta bandera).
  const [sessionChecked, setSessionChecked] = useState(() => !loadAuth()?.token)

  useEffect(() => {
    if (state.token) setAuthToken(state.token)
  }, [state.token])

  // Compartido entre el efecto de montaje y refreshSession(): establece la
  // sesión (y decide si el borrador sigue siendo del mismo usuario) antes de
  // reescribir pamir_auth, y solo aplica la respuesta si el token con el que
  // se pidió /me sigue siendo el vigente (evita pisar un logout/login
  // distinto que haya ocurrido mientras la petición estaba en vuelo). Esto
  // es un REFRESCO, no un login nuevo: mantiene el registro en el storage
  // donde ya estaba (isAuthRemembered) en vez de forzarlo siempre a
  // localStorage, o un simple refresco de /me convertiría en silencio una
  // sesión "no recordada" en persistente.
  const applyUser = useCallback((user: User, token: string) => {
    establishSession({ user, token }, { remember: isAuthRemembered() })
    setState((prev) => (prev.token === token ? { user, token } : prev))
  }, [])

  // Al montar con sesión guardada, refresca el usuario desde el servidor:
  // corrige payloads antiguos de pamir_auth que aún no traen rol. Si el token
  // expiró o no hay conexión, se conserva el comportamiento existente.
  useEffect(() => {
    const saved = loadAuth()
    if (!saved?.token) return
    const savedToken = saved.token
    // Ruling 2 del plan de esta PR: en la raíz sin slug, con varias
    // membresías YA conocidas por una sesión guardada, esta llamada
    // recibiría siempre 400 "Selecciona un club" (authMiddleware) — se
    // evita a propósito; App.tsx muestra "Mis clubes" con los datos
    // guardados sin esperar ninguna red. sessionChecked se asienta en true
    // igual: esta rama es la propia decisión de Ruling 2 de confiar en el
    // caché, no la ventana de verificación que sessionChecked cubre.
    const slug = clubSlugFromPath()
    if (!slug && (saved.user?.clubes?.length ?? 0) > 1) {
      setSessionChecked(true)
      return
    }

    fetchMe()
      .then(({ user }) => {
        setClubAccessError(null)
        applyUser(user, savedToken)
      })
      .catch((err: unknown) => {
        // La decisión completa (Ruling 1 incluido) vive en deriveClubAccessError,
        // pura y testeada aparte (lib/club-access.test.ts) sin depender de React.
        const clubError = deriveClubAccessError(slug, err)
        if (clubError) {
          setClubAccessError(clubError)
          return
        }
        // Token inválido/expirado o red caída: no se toca el estado
      })
      .finally(() => setSessionChecked(true))
  }, [applyUser])

  const refreshSession = useCallback(async (): Promise<void> => {
    const token = state.token
    if (!token) return
    const { user } = await fetchMe()
    setClubAccessError(null)
    applyUser(user, token)
  }, [state.token, applyUser])

  const login = useCallback(async (email: string, password: string, remember: boolean): Promise<void> => {
    setIsLoading(true)
    try {
      const { user, token } = await loginWithCredentials(email, password)
      setAuthToken(token)
      establishSession({ user, token }, { remember })
      setClubAccessError(null)
      // user acá viene directo de la respuesta del servidor (no del caché
      // de pamir_auth): ya está verificado, sin ventana que esperar.
      setSessionChecked(true)
      setState({ user, token })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback((): void => {
    clearAuth()
    setAuthToken(null)
    setClubAccessError(null)
    // Sin sesión no hay nada que verificar — igual que el estado inicial
    // sin pamir_auth guardado.
    setSessionChecked(true)
    setState({ user: null, token: null })
  }, [])

  return {
    user: state.user,
    token: state.token,
    isLoading,
    loginWithCredentials: login,
    logout,
    refreshSession,
    clubAccessError,
    sessionChecked,
  }
}
