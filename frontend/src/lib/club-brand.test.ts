import { describe, expect, it } from 'vitest'
import {
  clubDisplayName,
  clubShortName,
  clubLogoSrc,
  clubMemberBadge,
  esSocioDelClub,
  documentTitle,
  DEFAULT_CLUB_LOGO,
} from './club-brand'
import type { Organization } from '../types/salida'

const PAMIR: Organization = {
  id: 'org-pamir',
  slug: 'pamir',
  name: 'Andino Club Pamir',
  shortName: 'Pamir',
  membresiaPropia: 'SOCIO_ANDINO_PAMIR',
}

const EL_MONTANISTA: Organization = {
  id: 'org-montanista',
  slug: 'el-montanista',
  name: 'Club Andino El Montañista',
  shortName: 'El Montañista',
  membresiaPropia: 'SOCIO_EL_MONTANISTA',
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
  it('arma la ruta a partir de un slug válido', () => {
    expect(clubLogoSrc('pamir')).toBe('/logos/pamir.png')
    expect(clubLogoSrc('el-montanista')).toBe('/logos/el-montanista.png')
  })

  it('cae al logo por defecto sin slug', () => {
    expect(clubLogoSrc(null)).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc(undefined)).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc('')).toBe(DEFAULT_CLUB_LOGO)
  })

  it('rechaza un slug con formato inválido (mayúsculas, espacios, path traversal)', () => {
    expect(clubLogoSrc('Pamir')).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc('../etc/passwd')).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc('pamir club')).toBe(DEFAULT_CLUB_LOGO)
    expect(clubLogoSrc('-pamir')).toBe(DEFAULT_CLUB_LOGO)
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
