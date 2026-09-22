import { useContext } from 'react'
import { OrganizationContext, ORGANIZATION_FALLBACK, type OrganizationContextValue } from '../contexts/organization-context'

export function useOrganization(): OrganizationContextValue {
  return useContext(OrganizationContext) ?? ORGANIZATION_FALLBACK
}
