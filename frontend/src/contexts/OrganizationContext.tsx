import { useMemo, type ReactNode } from 'react'
import type { Organization } from '../types/salida'
import { clubDisplayName, clubShortName, clubMemberBadge, clubLogoSrc } from '../lib/club-brand'
import { OrganizationContext, type OrganizationContextValue } from './organization-context'

interface OrganizationProviderProps {
  // null/undefined mientras no hay sesión, o mientras la hay pero /me todavía
  // no resolvió el club (pamir_auth guardado por una sesión anterior a esta
  // fase). En ambos casos el árbol renderiza con branding neutral — nunca con
  // el club de otro usuario del mismo navegador.
  organization: Organization | null | undefined
  children: ReactNode
}

export function OrganizationProvider({ organization, children }: OrganizationProviderProps) {
  const value = useMemo<OrganizationContextValue>(() => {
    const org = organization ?? null
    return {
      organization: org,
      displayName: clubDisplayName(org),
      shortName: clubShortName(org),
      memberBadge: clubMemberBadge(org),
      logoSrc: clubLogoSrc(org),
    }
  }, [organization])

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}
