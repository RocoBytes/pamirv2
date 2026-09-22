// Helpers puros de branding por club: ni el logo ni el nombre de un club
// deben quedar hardcodeados en un componente — todo pasa por acá para que
// cambiar de club (o agregar uno nuevo) sea cuestión de datos, no de código.
import type { Organization, OrganizationBrand, MembresiaClub, IntegranteRecord } from '../types/salida'
import { CLUB_BADGE_LABELS } from '../types/salida'

// Nombre neutral cuando todavía no se conoce el club (pre-login, /me sin
// resolver aún, o una invitación/evaluación cuyo backend no lo resolvió).
const NEUTRAL_CLUB_NAME = 'Tu club'

export const DEFAULT_CLUB_LOGO = '/logos/_default.svg'

type NameSource = Pick<Organization | OrganizationBrand, 'name' | 'shortName'>

export function clubDisplayName(org: NameSource | null | undefined): string {
  return org?.name?.trim() || NEUTRAL_CLUB_NAME
}

export function clubShortName(org: NameSource | null | undefined): string {
  return org?.shortName?.trim() || org?.name?.trim() || NEUTRAL_CLUB_NAME
}

// Un slug de club es siempre minúsculas/números/guiones (ver la validación
// del backend en tenants.service.ts): cualquier otra cosa cae al logo neutral
// en vez de intentar armar una URL con datos no confiables.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function clubLogoSrc(slug: string | null | undefined): string {
  if (!slug || !SLUG_PATTERN.test(slug)) return DEFAULT_CLUB_LOGO
  return `/logos/${encodeURIComponent(slug)}.png`
}

// Etiqueta para "socios de ESTE club" (p.ej. la tarjeta de Documentación del
// Club). Usa la etiqueta corta ya definida para la membresía propia del club
// si existe (ACP, CAEM...); si el club tiene una membresiaPropia que no está
// en CLUB_BADGE_LABELS (dato libre, no necesariamente uno de los valores del
// enum), cae al nombre corto del club.
export function clubMemberBadge(org: Organization | null | undefined): string {
  if (!org) return NEUTRAL_CLUB_NAME
  const label = CLUB_BADGE_LABELS[org.membresiaPropia as MembresiaClub]
  return label ?? clubShortName(org)
}

// Semántica "socio de ESTE club", no "es socio de Pamir": compara la
// membresía del integrante contra la membresiaPropia del club que consulta,
// nunca contra un club fijo. false si falta cualquiera de los dos datos.
export function esSocioDelClub(
  integrante: Pick<IntegranteRecord, 'membresiaClub'> | null | undefined,
  org: Organization | null | undefined,
): boolean {
  if (!integrante?.membresiaClub || !org?.membresiaPropia) return false
  return integrante.membresiaClub === org.membresiaPropia
}

const GENERIC_TITLE = 'Registro de Salidas de Montaña'

export function documentTitle(org: NameSource | null | undefined): string {
  if (!org) return GENERIC_TITLE
  return `${clubShortName(org)} — ${GENERIC_TITLE}`
}
