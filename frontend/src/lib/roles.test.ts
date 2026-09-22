import { describe, expect, it } from 'vitest'
import { rolesInvitables, puedeInvitar } from './roles'

describe('rolesInvitables', () => {
  it('ADMIN puede invitar cualquier rol', () => {
    expect(rolesInvitables('ADMIN')).toEqual(['SOCIO', 'LIDER', 'ADMIN'])
  })

  it('LIDER solo puede invitar SOCIO', () => {
    expect(rolesInvitables('LIDER')).toEqual(['SOCIO'])
  })

  it('SOCIO no puede invitar a nadie', () => {
    expect(rolesInvitables('SOCIO')).toEqual([])
  })

  it('un rol indefinido no puede invitar a nadie', () => {
    expect(rolesInvitables(undefined)).toEqual([])
  })
})

describe('puedeInvitar', () => {
  it('es true para ADMIN', () => {
    expect(puedeInvitar('ADMIN')).toBe(true)
  })

  it('es true para LIDER', () => {
    expect(puedeInvitar('LIDER')).toBe(true)
  })

  it('es false para SOCIO', () => {
    expect(puedeInvitar('SOCIO')).toBe(false)
  })

  it('es false para un rol indefinido', () => {
    expect(puedeInvitar(undefined)).toBe(false)
  })
})
