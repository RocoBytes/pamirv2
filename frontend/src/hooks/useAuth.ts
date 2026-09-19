import { useState, useCallback, useEffect } from 'react'
import type { User, AuthState } from '../types/salida'
import { saveAuth, loadAuth, clearAuth } from '../lib/storage'
import { setAuthToken } from '../lib/auth-token'
import { loginWithCredentials, registerUser, fetchMe } from '../lib/api'

interface UseAuthReturn extends AuthState {
  loginWithCredentials: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
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

  // Al montar con sesión guardada, refresca el usuario desde el servidor:
  // corrige payloads antiguos de pamir_auth que aún no traen rol. Si el token
  // expiró o no hay conexión, se conserva el comportamiento existente.
  useEffect(() => {
    const saved = loadAuth()
    if (!saved?.token) return
    fetchMe()
      .then(({ user }) => {
        setState((prev) => {
          if (prev.token !== saved.token) return prev
          saveAuth({ user, token: saved.token })
          return { user, token: saved.token }
        })
      })
      .catch(() => {
        // Token inválido/expirado o red caída: no se toca el estado
      })
  }, [])

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    setIsLoading(true)
    try {
      const { user, token } = await loginWithCredentials(email, password)
      setAuthToken(token)
      saveAuth({ user, token })
      setState({ user, token })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const register = useCallback(async (name: string, email: string, password: string): Promise<void> => {
    setIsLoading(true)
    try {
      await registerUser(name, email, password)
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
    register,
    logout,
  }
}
