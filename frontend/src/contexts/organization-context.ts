// Objeto de contexto puro (sin JSX): separado de OrganizationContext.tsx y de
// hooks/useOrganization.ts porque react-refresh/only-export-components exige
// que un archivo que exporta un componente no exporte también otras cosas.
import { createContext } from 'react'
import type { Organization } from '../types/salida'
import { clubDisplayName, clubShortName, clubMemberBadge, clubLogoSrc } from '../lib/club-brand'

export interface OrganizationContextValue {
  organization: Organization | null
  displayName: string
  shortName: string
  memberBadge: string
  logoSrc: string
}

export const OrganizationContext = createContext<OrganizationContextValue | null>(null)

// Valores neutrales si algún componente se renderiza fuera del provider
// (no debería pasar en la app real: App.tsx lo monta una sola vez en la raíz).
export const ORGANIZATION_FALLBACK: OrganizationContextValue = {
  organization: null,
  displayName: clubDisplayName(null),
  shortName: clubShortName(null),
  memberBadge: clubMemberBadge(null),
  logoSrc: clubLogoSrc(null),
}
