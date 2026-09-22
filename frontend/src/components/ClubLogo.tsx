import { useState } from 'react'
import { useOrganization } from '../hooks/useOrganization'
import { clubDisplayName, clubLogoSrc, DEFAULT_CLUB_LOGO } from '../lib/club-brand'
import type { Organization, OrganizationBrand } from '../types/salida'

interface ClubLogoProps {
  className?: string
  // Por defecto describe el club (ícono informativo). Pasa "" cuando el
  // nombre del club ya es visible al lado del logo (queda decorativo) para
  // no duplicarlo en un lector de pantalla.
  alt?: string
  // Pantallas SIN sesión cuyo club no es el de la sesión global (aceptar una
  // invitación, evaluación express): pasa la marca resuelta por ESE endpoint
  // en vez de leerla del contexto. undefined (por defecto) = usar el
  // contexto de la sesión actual.
  org?: Organization | OrganizationBrand | null
}

// Renderiza /logos/<slug>.png; sin club conocido, o si ese archivo no existe,
// cae UNA sola vez al logo neutral — nunca queda pegada en un bucle de error,
// y nunca muestra el logo de otro club.
export function ClubLogo({ className, alt, org }: ClubLogoProps) {
  const ctx = useOrganization()
  const usingOverride = org !== undefined
  const effectiveOrg = usingOverride ? org : ctx.organization
  const logoSrc = usingOverride ? clubLogoSrc(effectiveOrg?.slug) : ctx.logoSrc
  const displayName = usingOverride ? clubDisplayName(effectiveOrg) : ctx.displayName

  // Recuerda el último src que falló: si logoSrc cambia (otro club, u otra
  // sesión en el mismo árbol de React) vuelve a intentar el logo real antes
  // de rendirse de nuevo al default.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null)
  const resolvedSrc = erroredSrc === logoSrc ? DEFAULT_CLUB_LOGO : logoSrc

  return (
    <img
      src={resolvedSrc}
      alt={alt ?? displayName}
      className={className}
      onError={() => {
        if (resolvedSrc === logoSrc) setErroredSrc(logoSrc)
      }}
    />
  )
}
