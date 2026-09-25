import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { deriveClubAccessError, CLUB_SUSPENDIDO_MENSAJE } from './club-access'

describe('deriveClubAccessError', () => {
  it('sin slug en el path, siempre null aunque el error sea 403/404 (Ruling 1)', () => {
    expect(deriveClubAccessError(null, new ApiError('No perteneces a este club', 403))).toBeNull()
    expect(deriveClubAccessError(null, new ApiError('Club no encontrado', 404))).toBeNull()
  })

  it('404 con slug → no-encontrado', () => {
    const result = deriveClubAccessError('el-montanista', new ApiError('Club no encontrado', 404))
    expect(result).toEqual({ status: 404, message: 'Club no encontrado', kind: 'no-encontrado' })
  })

  it('403 "no soy socio" con slug → no-socio', () => {
    const result = deriveClubAccessError('el-montanista', new ApiError('No perteneces a este club', 403))
    expect(result).toEqual({ status: 403, message: 'No perteneces a este club', kind: 'no-socio' })
  })

  it('403 con el mensaje exacto de club suspendido con slug → suspendido', () => {
    const result = deriveClubAccessError('el-montanista', new ApiError(CLUB_SUSPENDIDO_MENSAJE, 403))
    expect(result).toEqual({ status: 403, message: CLUB_SUSPENDIDO_MENSAJE, kind: 'suspendido' })
  })

  it('401 con slug → null (sesión expirada, no es un error de club)', () => {
    expect(deriveClubAccessError('el-montanista', new ApiError('Autenticación requerida', 401))).toBeNull()
  })

  it('500 con slug → null (fallo genérico del servidor, no es un error de club)', () => {
    expect(deriveClubAccessError('el-montanista', new ApiError('Error al obtener el usuario', 500))).toBeNull()
  })

  it('error de red (no ApiError) con slug → null', () => {
    expect(deriveClubAccessError('el-montanista', new TypeError('Failed to fetch'))).toBeNull()
  })
})
