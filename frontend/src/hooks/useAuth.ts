import { useState, useCallback, useEffect } from 'react'
import type { User, AuthState } from '../types/salida'
import { establishSession, loadAuth, clearAuth, isAuthRemembered } from '../lib/storage'
import { setAuthToken } from '../lib/auth-token'
import { loginWithCredentials, fetchMe } from '../lib/api'

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
    fetchMe()
      .then(({ user }) => applyUser(user, savedToken))
      .catch(() => {
        // Token inválido/expirado o red caída: no se toca el estado
      })
  }, [applyUser])

  const refreshSession = useCallback(async (): Promise<void> => {
    const token = state.token
    if (!token) return
    const { user } = await fetchMe()
    applyUser(user, token)
  }, [state.token, applyUser])

  const login = useCallback(async (email: string, password: string, remember: boolean): Promise<void> => {
    setIsLoading(true)
    try {
      const { user, token } = await loginWithCredentials(email, password)
      setAuthToken(token)
      establishSession({ user, token }, { remember })
      setState({ user, token })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback((): void => {
    clearAuth()
    setAuthToken(null)
    setState({ user: null, token: null })
  }, [])

  return {
    user: state.user,
    token: state.token,
    isLoading,
    loginWithCredentials: login,
    logout,
    refreshSession,
  }
}
