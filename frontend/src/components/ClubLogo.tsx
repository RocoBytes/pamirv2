import { useState } from 'react'
import { useOrganization } from '../hooks/useOrganization'
import { clubDisplayName, clubLogoCandidates } from '../lib/club-brand'
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

// Renderiza el logo subido por el club (si tiene uno), y si falla baja UN
// escalón a la convención estática /logos/<slug>.png, y si esa también falla
// baja al neutral — nunca salta directo al neutral desde el logo subido, y
// nunca queda pegada en un bucle de error ni muestra el logo de otro club.
export function ClubLogo({ className, alt, org }: ClubLogoProps) {
  const ctx = useOrganization()
  const usingOverride = org !== undefined
  const effectiveOrg = usingOverride ? org : ctx.organization
  const displayName = usingOverride ? clubDisplayName(effectiveOrg) : ctx.displayName

  const candidates = clubLogoCandidates(effectiveOrg)

  // Índice del candidato mostrado. Se resetea a 0 en cuanto cambia la lista
  // de candidatos (otro club, u otra sesión en el mismo árbol de React) —
  // ajustando el estado durante el render, no en un efecto, para que el logo
  // de un club nunca sobreviva un cambio de sesión mostrando el último
  // candidato que había fallado antes.
  const candidatesKey = candidates.join('|')
  const [state, setState] = useState({ key: candidatesKey, index: 0 })
  if (state.key !== candidatesKey) {
    setState({ key: candidatesKey, index: 0 })
  }
  const index = state.key === candidatesKey ? state.index : 0
  const resolvedSrc = candidates[Math.min(index, candidates.length - 1)]

  return (
    <img
      src={resolvedSrc}
      alt={alt ?? displayName}
      className={className}
      onError={() => {
        // Baja un escalón nada más: un logo subido roto todavía prueba el
        // estático antes de rendirse al neutral.
        setState((prev) =>
          prev.index < candidates.length - 1 ? { key: prev.key, index: prev.index + 1 } : prev,
        )
      }}
    />
  )
}
