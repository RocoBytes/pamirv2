// Helpers puros de branding por club: ni el logo ni el nombre de un club
// deben quedar hardcodeados en un componente — todo pasa por acá para que
// cambiar de club (o agregar uno nuevo) sea cuestión de datos, no de código.
import type { Organization, OrganizationBrand, MembresiaClub, IntegranteRecord } from '../types/salida'
import { CLUB_BADGE_LABELS } from '../types/salida'

// Nombre neutral cuando todavía no se conoce el club (pre-login, /me sin
// resolver aún, o una invitación/evaluación cuyo backend no lo resolvió).
const NEUTRAL_CLUB_NAME = 'Tu club'

// Emblema de RIALA (la plataforma, no un club): fallback de cualquier club sin
// logo propio, y el logo que se ve en las pantallas sin sesión sin club
// resuelto (login neutral, ver AuthPage.tsx). Reemplaza al SVG de montaña
// genérico que usaba antes.
export const DEFAULT_CLUB_LOGO = '/brand/riala-emblem.png'

// Lockup completo de la marca (emblema + wordmark + tagline), usado en el
// login neutral en vez del ícono chico + nombre de club.
export const PLATFORM_LOGO_FULL = '/brand/riala-logo.webp'
export const PLATFORM_NAME = 'RIALA'

type NameSource = Pick<Organization | OrganizationBrand, 'name' | 'shortName'>

export function clubDisplayName(org: NameSource | null | undefined): string {
  return org?.name?.trim() || NEUTRAL_CLUB_NAME
}

export function clubShortName(org: NameSource | null | undefined): string {
  return org?.shortName?.trim() || org?.name?.trim() || NEUTRAL_CLUB_NAME
}

// Un slug de club es siempre minúsculas/números/guiones (ver la validación
// del backend en tenants.service.ts): cualquier otra cosa cae al logo neutral
// en vez de intentar armar una URL con datos no confiables. Exportado para que
// club-preferido.ts valide con el mismo criterio el slug que viene de la URL o
// de localStorage — ninguno de los dos es un dato confiable por sí solo.
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

type LogoSource = Pick<Organization | OrganizationBrand, 'slug' | 'hasLogo' | 'logoVersion'>

// Lista de candidatos en orden de preferencia: logo subido por el club →
// convención estática del repo (/logos/<slug>.png) → neutral. ClubLogo.tsx
// recorre esta lista un escalón a la vez ante cada error de carga, en vez de
// rendirse directo al neutral — así un logo subido roto todavía prueba el
// estático antes de caer al default. clubLogoSrc() es el primer candidato:
// lo que se pinta antes de que nada falle.
export function clubLogoCandidates(org: LogoSource | null | undefined): string[] {
  const slug = org?.slug
  if (!slug || !SLUG_PATTERN.test(slug)) return [DEFAULT_CLUB_LOGO]

  const safe = encodeURIComponent(slug)
  const candidates: string[] = []
  if (org?.hasLogo) {
    const v = org.logoVersion ? `?v=${encodeURIComponent(org.logoVersion)}` : ''
    candidates.push(`/api/clubes/${safe}/logo${v}`)
  }
  candidates.push(`/logos/${safe}.png`)
  candidates.push(DEFAULT_CLUB_LOGO)
  return candidates
}

export function clubLogoSrc(org: LogoSource | null | undefined): string {
  return clubLogoCandidates(org)[0]!
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
