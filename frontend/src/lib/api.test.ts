import { afterEach, describe, expect, it, vi } from 'vitest'
import { authHeaders } from './api'
import { setAuthToken } from './auth-token'

// authHeaders() es el único punto de integración de X-Club (ver el comentario
// junto a su definición en api.ts): un bug ahí filtraría o esconvería el
// header en las ~40 llamadas autenticadas de este archivo sin que ningún test
// existente lo notara. window no existe en el entorno de test (vitest corre
// en Node, sin jsdom) — se stubea con vi.stubGlobal, mismo patrón que
// file-download.test.ts.
describe('authHeaders', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setAuthToken(null)
  })

  it('en /<slug> agrega X-Club con el slug del path', () => {
    vi.stubGlobal('window', { location: { pathname: '/el-montanista' } })
    expect(authHeaders()['X-Club']).toBe('el-montanista')
  })

  it('en /<slug> con una sesión guardada agrega también Authorization', () => {
    vi.stubGlobal('window', { location: { pathname: '/pamir' } })
    setAuthToken('mock-jwt-token')
    expect(authHeaders()).toEqual({
      Authorization: 'Bearer mock-jwt-token',
      'X-Club': 'pamir',
    })
  })

  it('en el dominio raíz (sin slug) no manda X-Club', () => {
    vi.stubGlobal('window', { location: { pathname: '/' } })
    expect(authHeaders()['X-Club']).toBeUndefined()
  })

  it('en una ruta reservada (p.ej. /admin) no manda X-Club', () => {
    vi.stubGlobal('window', { location: { pathname: '/admin' } })
    expect(authHeaders()['X-Club']).toBeUndefined()
  })

  it('en un path inválido (mayúsculas/espacios) no manda X-Club', () => {
    vi.stubGlobal('window', { location: { pathname: '/Con Mayusculas' } })
    expect(authHeaders()['X-Club']).toBeUndefined()
  })
})
