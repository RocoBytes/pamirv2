import { describe, expect, it } from 'vitest'
import { buildQrFileName, svgToDataUrl } from './qr'

describe('svgToDataUrl', () => {
  it('arma una data URL image/svg+xml codificada con encodeURIComponent', () => {
    const svg = '<svg><rect width="1" height="1"/></svg>'
    expect(svgToDataUrl(svg)).toBe(`data:image/svg+xml,${encodeURIComponent(svg)}`)
  })

  it('escapa caracteres especiales (comillas, #, espacios) sin romper la URL', () => {
    const svg = '<svg data-x="a b#c"></svg>'
    const url = svgToDataUrl(svg)
    expect(url.startsWith('data:image/svg+xml,')).toBe(true)
    expect(url).not.toContain(' ')
    expect(url).not.toContain('#')
  })
})

describe('buildQrFileName', () => {
  const fecha = new Date(2026, 2, 5) // 5 de marzo de 2026 (mes 0-indexado)

  it('arma el nombre con el slug, la fecha en YYYYMMDD y la extensión', () => {
    expect(buildQrFileName('el-montanista', fecha, 'png')).toBe('riala-qr-el-montanista-20260305.png')
  })

  it('acepta svg como extensión', () => {
    expect(buildQrFileName('pamir', fecha, 'svg')).toBe('riala-qr-pamir-20260305.svg')
  })

  it('rellena mes y día con cero a la izquierda', () => {
    const primeroDeEnero = new Date(2026, 0, 1)
    expect(buildQrFileName('pamir', primeroDeEnero, 'png')).toBe('riala-qr-pamir-20260101.png')
  })

  it('sanea mayúsculas, acentos y espacios en el slug', () => {
    expect(buildQrFileName('El Montañista', fecha, 'png')).toBe('riala-qr-el-montanista-20260305.png')
  })

  it('sanea caracteres fuera de [a-z0-9-] (path traversal, símbolos)', () => {
    expect(buildQrFileName('../../etc/passwd', fecha, 'png')).toBe('riala-qr-etc-passwd-20260305.png')
  })

  it('colapsa separadores repetidos y recorta guiones en los bordes', () => {
    expect(buildQrFileName('--club  raro--', fecha, 'png')).toBe('riala-qr-club-raro-20260305.png')
  })

  it('cae a "club" si el slug queda vacío tras sanear', () => {
    expect(buildQrFileName('###', fecha, 'png')).toBe('riala-qr-club-20260305.png')
  })
})
