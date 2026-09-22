import { useContext } from 'react'
import {
  NavPreferencesContext,
  NAV_PREFERENCES_FALLBACK,
  type NavPreferencesValue,
} from '../contexts/nav-preferences-context'

export function useNavPreferences(): NavPreferencesValue {
  return useContext(NavPreferencesContext) ?? NAV_PREFERENCES_FALLBACK
}
