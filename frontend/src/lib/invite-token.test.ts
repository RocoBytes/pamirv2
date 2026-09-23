import { describe, expect, it } from 'vitest'
import { parseInviteToken, parseQrToken } from './invite-token'

describe('parseInviteToken', () => {
  it('extrae el token de un fragmento con #', () => {
    expect(parseInviteToken('#invite=abc123')).toBe('abc123')
  })

  it('extrae el token de un fragmento sin # inicial', () => {
    expect(parseInviteToken('invite=abc123')).toBe('abc123')
  })

  it('tolera otros parámetros después del token', () => {
    expect(parseInviteToken('#invite=abc123&foo=bar')).toBe('abc123')
  })

  it('tolera otros parámetros antes del token', () => {
    expect(parseInviteToken('#foo=bar&invite=abc123')).toBe('abc123')
  })

  it('devuelve null si falta el parámetro invite', () => {
    expect(parseInviteToken('#foo=bar')).toBeNull()
  })

  it('devuelve null para un fragmento vacío', () => {
    expect(parseInviteToken('')).toBeNull()
  })

  it('devuelve null para un fragmento con solo #', () => {
    expect(parseInviteToken('#')).toBeNull()
  })

  it('devuelve null si el valor de invite está vacío', () => {
    expect(parseInviteToken('#invite=')).toBeNull()
  })

  it('devuelve null si el token excede 200 caracteres', () => {
    const largo = 'a'.repeat(201)
    expect(parseInviteToken(`#invite=${largo}`)).toBeNull()
  })

  it('acepta un token de exactamente 200 caracteres', () => {
    const limite = 'a'.repeat(200)
    expect(parseInviteToken(`#invite=${limite}`)).toBe(limite)
  })

  it('nunca lanza con entradas malformadas', () => {
    expect(() => parseInviteToken('#invite=%%%')).not.toThrow()
    expect(() => parseInviteToken('###')).not.toThrow()
  })
})

describe('parseQrToken', () => {
  it('extrae el token de un fragmento con #', () => {
    expect(parseQrToken('#qr=abc123')).toBe('abc123')
  })

  it('extrae el token de un fragmento sin # inicial', () => {
    expect(parseQrToken('qr=abc123')).toBe('abc123')
  })

  it('tolera otros parámetros después del token', () => {
    expect(parseQrToken('#qr=abc123&foo=bar')).toBe('abc123')
  })

  it('tolera otros parámetros antes del token', () => {
    expect(parseQrToken('#foo=bar&qr=abc123')).toBe('abc123')
  })

  it('devuelve null si falta el parámetro qr', () => {
    expect(parseQrToken('#foo=bar')).toBeNull()
  })

  it('devuelve null para un fragmento vacío', () => {
    expect(parseQrToken('')).toBeNull()
  })

  it('devuelve null para un fragmento con solo #', () => {
    expect(parseQrToken('#')).toBeNull()
  })

  it('devuelve null si el valor de qr está vacío', () => {
    expect(parseQrToken('#qr=')).toBeNull()
  })

  it('devuelve null si el token excede 200 caracteres', () => {
    const largo = 'a'.repeat(201)
    expect(parseQrToken(`#qr=${largo}`)).toBeNull()
  })

  it('acepta un token de exactamente 200 caracteres', () => {
    const limite = 'a'.repeat(200)
    expect(parseQrToken(`#qr=${limite}`)).toBe(limite)
  })

  it('nunca lanza con entradas malformadas', () => {
    expect(() => parseQrToken('#qr=%%%')).not.toThrow()
    expect(() => parseQrToken('###')).not.toThrow()
  })

  it('no confunde un fragmento #invite= con uno #qr=', () => {
    expect(parseQrToken('#invite=abc123')).toBeNull()
  })
})
