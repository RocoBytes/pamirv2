import { createContext } from 'react'
import type { NavPreferences } from '../lib/api'

export interface NavPreferencesValue {
  /** null mientras carga, o si el socio nunca personalizó: manda el default. */
  preferences: NavPreferences | null
  /** false hasta que la primera consulta terminó (bien o mal). */
  loaded: boolean
  /** Guarda y aplica de inmediato; revierte si el servidor rechaza. */
  save: (next: NavPreferences) => Promise<void>
  /** Vuelve al orden por defecto. */
  reset: () => Promise<void>
  /** Último error de guardado, para avisar sin romper la navegación. */
  error: string | null
}

// Sin proveedor la app funciona igual, con el orden por defecto y sin poder
// personalizar: la navegación nunca depende de que esta consulta haya salido
// bien. Es una preferencia, no un permiso.
export const NAV_PREFERENCES_FALLBACK: NavPreferencesValue = {
  preferences: null,
  loaded: false,
  save: async () => {},
  reset: async () => {},
  error: null,
}

export const NavPreferencesContext = createContext<NavPreferencesValue | null>(null)
