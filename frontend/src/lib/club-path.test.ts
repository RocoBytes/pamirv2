import { describe, expect, it, vi } from 'vitest'
import { clubSlugFromPath, redirectLegacyClubQueryParam, puedeAbrirClub } from './club-path'

describe('clubSlugFromPath', () => {
  it('extrae el primer segmento de un path de club', () => {
    expect(clubSlugFromPath('/el-montanista')).toBe('el-montanista')
  })

  it('extrae el primer segmento aunque haya más path después', () => {
    expect(clubSlugFromPath('/el-montanista/lo-que-sea')).toBe('el-montanista')
  })

  it('devuelve null para la raíz', () => {
    expect(clubSlugFromPath('/')).toBeNull()
  })

  it('devuelve null para un path vacío', () => {
    expect(clubSlugFromPath('')).toBeNull()
  })

  it('devuelve null para un segmento que no cumple el patrón de slug', () => {
    expect(clubSlugFromPath('/Con Mayusculas Y Espacios')).toBeNull()
  })

  it('acepta guiones simples en minúsculas', () => {
    expect(clubSlugFromPath('/club-de-prueba-2')).toBe('club-de-prueba-2')
  })

  it('devuelve null para cada ruta reservada de nivel superior', () => {
    const reservadas = ['assets', 'auth', 'brand', 'api', 'platform', 'plataforma', 'admin', 'www', 'app', 'riala']
    for (const slug of reservadas) {
      expect(clubSlugFromPath(`/${slug}`)).toBeNull()
    }
  })

  it('devuelve null para una ruta reservada aunque haya más path después', () => {
    expect(clubSlugFromPath('/assets/logo.png')).toBeNull()
  })
})

describe('redirectLegacyClubQueryParam', () => {
  it('reescribe ?club=<slug> a /<slug> cuando no hay slug en el path', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '?club=el-montanista', pathname: '/', hash: '', replaceState })
    expect(replaceState).toHaveBeenCalledWith('/el-montanista')
  })

  it('no hace nada si ya hay un slug en el path', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '?club=el-montanista', pathname: '/riala', replaceState })
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('no hace nada sin ?club= en la URL', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '', pathname: '/', replaceState })
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('no hace nada si el valor de ?club= no es un slug válido', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '?club=../../etc', pathname: '/', replaceState })
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('no hace nada si el valor de ?club= es una ruta reservada', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({ search: '?club=api', pathname: '/', replaceState })
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('conserva el resto de los parámetros al reescribir', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({
      search: '?club=el-montanista&foo=bar',
      pathname: '/',
      hash: '',
      replaceState,
    })
    expect(replaceState).toHaveBeenCalledWith('/el-montanista?foo=bar')
  })

  it('conserva el fragmento (token de invitación/QR) intacto al reescribir', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({
      search: '?club=el-montanista',
      pathname: '/',
      hash: '#invite=un-token-secreto',
      replaceState,
    })
    expect(replaceState).toHaveBeenCalledWith('/el-montanista#invite=un-token-secreto')
  })

  it('conserva parámetros y fragmento juntos al reescribir', () => {
    const replaceState = vi.fn()
    redirectLegacyClubQueryParam({
      search: '?club=el-montanista&foo=bar',
      pathname: '/',
      hash: '#invite=un-token-secreto',
      replaceState,
    })
    expect(replaceState).toHaveBeenCalledWith('/el-montanista?foo=bar#invite=un-token-secreto')
  })
})

describe('puedeAbrirClub', () => {
  const pamir = { slug: 'pamir', suspendido: false }
  const montanistaSuspendido = { slug: 'el-montanista', suspendido: true }

  it('true si el slug está en clubes y esa membresía no está suspendida', () => {
    expect(puedeAbrirClub('pamir', [pamir])).toBe(true)
  })

  it('false si el slug no corresponde a ninguna membresía (typo, club ajeno)', () => {
    expect(puedeAbrirClub('no-existe', [pamir])).toBe(false)
  })

  it('false si la membresía de ese club está suspendida', () => {
    expect(puedeAbrirClub('el-montanista', [montanistaSuspendido])).toBe(false)
  })

  it('false sin slug', () => {
    expect(puedeAbrirClub(null, [pamir])).toBe(false)
  })

  it('false sin clubes conocidos todavía (Ruling 3: "no se sabe" nunca es "no tiene")', () => {
    expect(puedeAbrirClub('pamir', null)).toBe(false)
  })

  it('elige la membresía correcta entre varias', () => {
    expect(puedeAbrirClub('el-montanista', [pamir, montanistaSuspendido])).toBe(false)
    expect(puedeAbrirClub('pamir', [pamir, montanistaSuspendido])).toBe(true)
  })
})
