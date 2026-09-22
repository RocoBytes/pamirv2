import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  fetchNavPreferences,
  saveNavPreferences,
  resetNavPreferences,
  type NavPreferences,
} from '../lib/api'
import { NavPreferencesContext, type NavPreferencesValue } from './nav-preferences-context'

interface NavPreferencesProviderProps {
  /** false sin sesión: no hay a quién consultarle sus preferencias. */
  enabled: boolean
  children: ReactNode
}

export function NavPreferencesProvider({ enabled, children }: NavPreferencesProviderProps) {
  const [preferences, setPreferences] = useState<NavPreferences | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Al cambiar la sesión se descarta lo cargado: el próximo usuario de este
  // mismo navegador no debe heredar la navegación del anterior. Se ajusta
  // durante el render y no dentro de un efecto —misma técnica que App.tsx con
  // prevAuthenticated— porque un setState en el cuerpo de un efecto dispara un
  // render en cascada y deja pintar una vez con los datos del usuario viejo.
  const [prevEnabled, setPrevEnabled] = useState(enabled)
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled)
    setPreferences(null)
    setLoaded(false)
  }

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetchNavPreferences()
      .then((prefs) => {
        if (!cancelled) setPreferences(prefs)
      })
      .catch(() => {
        // Una consulta fallida no es un estado de error visible: se cae al
        // orden por defecto y el socio navega igual.
        if (!cancelled) setPreferences(null)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const save = useCallback(
    async (next: NavPreferences) => {
      const previous = preferences
      // Optimista: reordenar tiene que sentirse instantáneo. Si el servidor
      // rechaza, se vuelve a lo anterior y se avisa — nunca se deja la interfaz
      // mostrando un orden que no quedó guardado.
      setPreferences(next)
      setError(null)
      try {
        const saved = await saveNavPreferences(next)
        setPreferences(saved)
      } catch (err) {
        setPreferences(previous)
        setError(err instanceof Error ? err.message : 'No se pudo guardar la navegación')
      }
    },
    [preferences],
  )

  const reset = useCallback(async () => {
    const previous = preferences
    setPreferences(null)
    setError(null)
    try {
      await resetNavPreferences()
    } catch (err) {
      setPreferences(previous)
      setError(err instanceof Error ? err.message : 'No se pudo restablecer la navegación')
    }
  }, [preferences])

  const value = useMemo<NavPreferencesValue>(
    () => ({ preferences, loaded, save, reset, error }),
    [preferences, loaded, save, reset, error],
  )

  return <NavPreferencesContext.Provider value={value}>{children}</NavPreferencesContext.Provider>
}
