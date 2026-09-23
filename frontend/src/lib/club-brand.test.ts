import { describe, expect, it } from 'vitest'
import {
  clubDisplayName,
  clubShortName,
  clubLogoSrc,
  clubLogoCandidates,
  clubMemberBadge,
  esSocioDelClub,
  documentTitle,
  DEFAULT_CLUB_LOGO,
  PLATFORM_LOGO_FULL,
  PLATFORM_NAME,
} from './club-brand'
import type { Organization } from '../types/salida'

// Alambre de tropiezo: fija los valores reales (no solo la constante contra
// sí misma, como hacen el resto de los tests de abajo) — así un cambio
// accidental de ruta de los assets de marca (ver frontend/public/brand/) se
// nota acá en vez de solo en un e2e.
describe('constantes de marca de la plataforma (RIALA)', () => {
  it('DEFAULT_CLUB_LOGO apunta al emblema de RIALA', () => {
    expect(DEFAULT_CLUB_LOGO).toBe('/brand/riala-emblem.png')
  })

  it('PLATFORM_LOGO_FULL apunta al lockup completo de RIALA', () => {
    expect(PLATFORM_LOGO_FULL).toBe('/brand/riala-logo.webp')
  })

  it('PLATFORM_NAME es "RIALA"', () => {
    expect(PLATFORM_NAME).toBe('RIALA')
  })
})

const PAMIR: Organization = {
  id: 'org-pamir',
  slug: 'pamir',
  name: 'Andino Club Pamir',
  shortName: 'Pamir',
  membresiaPropia: 'SOCIO_ANDINO_PAMIR',
  hasLogo: false,
  logoVersion: null,
}

const EL_MONTANISTA: Organization = {
  id: 'org-montanista',
  slug: 'el-montanista',
  name: 'Club Andino El Montañista',
  shortName: 'El Montañista',
  membresiaPropia: 'SOCIO_EL_MONTANISTA',
  hasLogo: false,
  logoVersion: null,
}

describe('clubDisplayName', () => {
  it('devuelve el nombre del club', () => {
    expect(clubDisplayName(PAMIR)).toBe('Andino Club Pamir')
  })

  it('cae a "Tu club" sin organización', () => {
    expect(clubDisplayName(null)).toBe('Tu club')
    expect(clubDisplayName(undefined)).toBe('Tu club')
  })
})

describe('clubShortName', () => {
  it('prefiere shortName sobre name', () => {
    expect(clubShortName(PAMIR)).toBe('Pamir')
  })

  it('cae a name si shortName es null', () => {
    expect(clubShortName({ name: 'Club Sin Apodo', shortName: null })).toBe('Club Sin Apodo')
  })

  it('cae a "Tu club" sin organización', () => {
    expect(clubShortName(null)).toBe('Tu club')
  })
})

describe('clubLogoSrc', () => {
  it('arma la ruta estática a partir de un slug válido sin logo propio', () => {
    expect(clubLogoSrc(PAMIR)).toBe('/logos/pamir.png')
    expect(clubLogoSrc(EL_MONTANISTA)).toBe('/logos/el-montanista.png')
  })

  it('prefiere el logo subido cuando hasLogo es true', () => {
    expect(clubLogoSrc({ ...PAMIR, hasLogo: true, logoVersion: 'abcd1234' })).toBe(
      '/api/clubes/pamir/logo?v=abcd1234',
    )
  })

  it('cae al logo por defecto sin organización', () => {
    expect(clubLogoSrc(null)).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc(undefined)).toBe(DEFAULT_CLUB_LOGO)
  })

  it('cae al logo por defecto sin slug o con slug vacío', () => {
    expect(clubLogoSrc({ ...PAMIR, slug: '' })).toBe(DEFAULT_CLUB_LOGO)
  })

  it('rechaza un slug con formato inválido (mayúsculas, espacios, path traversal)', () => {
    expect(clubLogoSrc({ ...PAMIR, slug: 'Pamir' })).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc({ ...PAMIR, slug: '../etc/passwd' })).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc({ ...PAMIR, slug: 'pamir club' })).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc({ ...PAMIR, slug: '-pamir' })).toBe(DEFAULT_CLUB_LOGO)
  })
})

// ─── clubLogoCandidates: los tres niveles de precedencia ─────────────────────
// ClubLogo.tsx recorre esta lista un escalón por vez ante cada error de carga
// (ver el componente): el orden y el contenido exacto de la lista son el
// contrato que sostiene ese fallback "nunca salta directo al neutral".
describe('clubLogoCandidates', () => {
  it('con logo subido: [subido, estático, neutral], en ese orden', () => {
    const org = { ...PAMIR, hasLogo: true, logoVersion: 'abcd1234' }
    expect(clubLogoCandidates(org)).toEqual([
      '/api/clubes/pamir/logo?v=abcd1234',
      '/logos/pamir.png',
      DEFAULT_CLUB_LOGO,
    ])
  })

  it('logo subido sin logoVersion: la URL no lleva ?v= (nunca debería pasar en la práctica, pero no debe romper)', () => {
    const org = { ...PAMIR, hasLogo: true, logoVersion: null }
    expect(clubLogoCandidates(org)[0]).toBe('/api/clubes/pamir/logo')
  })

  it('sin logo propio: [estático, neutral], sin el nivel subido', () => {
    expect(clubLogoCandidates(PAMIR)).toEqual(['/logos/pamir.png', DEFAULT_CLUB_LOGO])
  })

  it('sin slug válido: solo [neutral]', () => {
    expect(clubLogoCandidates(null)).toEqual([DEFAULT_CLUB_LOGO])
    expect(clubLogoCandidates({ ...PAMIR, slug: 'Slug Invalido' })).toEqual([DEFAULT_CLUB_LOGO])
  })
})

describe('clubMemberBadge', () => {
  it('usa la etiqueta corta conocida (ACP para Pamir)', () => {
    expect(clubMemberBadge(PAMIR)).toBe('ACP')
  })

  it('usa la etiqueta corta conocida (CAEM para El Montañista)', () => {
    expect(clubMemberBadge(EL_MONTANISTA)).toBe('CAEM')
  })

  it('cae al nombre corto del club si su membresiaPropia no tiene etiqueta conocida', () => {
    const clubLibre: Organization = { ...PAMIR, membresiaPropia: 'SOCIO_CUALQUIERA' }
    expect(clubMemberBadge(clubLibre)).toBe('Pamir')
  })

  it('cae a "Tu club" sin organización', () => {
    expect(clubMemberBadge(null)).toBe('Tu club')
  })
})

describe('esSocioDelClub', () => {
  it('true cuando la membresía del integrante coincide con la propia del club', () => {
    expect(esSocioDelClub({ membresiaClub: 'SOCIO_ANDINO_PAMIR' }, PAMIR)).toBe(true)
  })

  it('false cuando coincide con OTRO club (semántica "de este club", no "es Pamir")', () => {
    expect(esSocioDelClub({ membresiaClub: 'SOCIO_ANDINO_PAMIR' }, EL_MONTANISTA)).toBe(false)
  })

  it('false si falta el integrante, su membresía o el club', () => {
    expect(esSocioDelClub(null, PAMIR)).toBe(false)
    expect(esSocioDelClub({ membresiaClub: undefined }, PAMIR)).toBe(false)
    expect(esSocioDelClub({ membresiaClub: 'SOCIO_ANDINO_PAMIR' }, null)).toBe(false)
  })
})

describe('documentTitle', () => {
  it('antepone el nombre corto del club al título genérico', () => {
    expect(documentTitle(PAMIR)).toBe('Pamir — Registro de Salidas de Montaña')
  })

  it('usa el título genérico sin organización', () => {
    expect(documentTitle(null)).toBe('Registro de Salidas de Montaña')
    expect(documentTitle(undefined)).toBe('Registro de Salidas de Montaña')
  })
})
