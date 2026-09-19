import { describe, expect, it } from 'vitest'
import { restarDias, esFechaCompleta, fechaInputField } from './fechas'

describe('restarDias', () => {
  it('subtracts days within the same month', () => {
    expect(restarDias('2026-09-24', 2)).toBe('2026-09-22')
  })

  it('crosses a month boundary', () => {
    expect(restarDias('2026-03-01', 2)).toBe('2026-02-27')
  })

  it('does not map a low year to 19xx (regression)', () => {
    expect(restarDias('0002-09-24', 2)).toBe('0002-09-22')
  })
})

describe('esFechaCompleta', () => {
  it('accepts a plausible 4-digit year', () => {
    expect(esFechaCompleta('2026-09-24')).toBe(true)
  })

  it('rejects a padded intermediate year while typing', () => {
    expect(esFechaCompleta('0002-09-24')).toBe(false)
    expect(esFechaCompleta('0202-09-24')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(esFechaCompleta('')).toBe(false)
  })

  it('rejects a non-padded partial date', () => {
    expect(esFechaCompleta('2026-9-4')).toBe(false)
  })
})

describe('fechaInputField', () => {
  it('fails on an empty value with the empty message', () => {
    const result = fechaInputField('Selecciona la fecha').safeParse('')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Selecciona la fecha')
    }
  })

  it('fails on an implausible year with the invalid-date message', () => {
    const result = fechaInputField('Selecciona la fecha').safeParse('0002-09-24')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Fecha inválida: revisa el año (4 dígitos)')
    }
  })

  it('succeeds on a complete plausible date', () => {
    const result = fechaInputField('Selecciona la fecha').safeParse('2026-09-24')
    expect(result.success).toBe(true)
  })
})
