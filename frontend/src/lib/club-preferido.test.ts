import { describe, expect, it } from 'vitest'
import { clubDesdeUrl, clubRecordado, recordarClub, clubPreferido } from './club-preferido'

// ─── Doble de prueba de Storage (sin jsdom, mismo criterio que storage.test.ts) ─

function createFakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size
    },
  }
}

// Simula el modo privado de Safari: cada operación lanza.
function createThrowingStorage(): Storage {
  const boom = () => {
    throw new Error('storage blocked (private mode)')
  }
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }
}

describe('clubDesdeUrl', () => {
  it('lee un slug válido de ?club=', () => {
    expect(clubDesdeUrl('?club=pamir')).toBe('pamir')
    expect(clubDesdeUrl('?club=el-montanista&foo=1')).toBe('el-montanista')
  })

  it('descarta un slug con formato inválido en vez de confiar en el valor crudo', () => {
    expect(clubDesdeUrl('?club=Pamir')).toBeNull()
    expect(clubDesdeUrl('?club=../etc/passwd')).toBeNull()
    expect(clubDesdeUrl('?club=pamir%20club')).toBeNull()
  })

  it('null sin el parámetro', () => {
    expect(clubDesdeUrl('')).toBeNull()
    expect(clubDesdeUrl('?otra=cosa')).toBeNull()
  })

  it('sin window (entorno no-browser) no lanza: devuelve null', () => {
    expect(() => clubDesdeUrl()).not.toThrow()
    expect(clubDesdeUrl()).toBeNull()
  })
})

describe('clubRecordado / recordarClub', () => {
  it('roundtrip: lo que se recuerda se puede volver a leer', () => {
    const storage = createFakeStorage()
    recordarClub('pamir', storage)
    expect(clubRecordado(storage)).toBe('pamir')
  })

  it('null sin nada recordado', () => {
    expect(clubRecordado(createFakeStorage())).toBeNull()
  })

  it('recordarClub descarta un slug inválido silenciosamente (no escribe nada)', () => {
    const storage = createFakeStorage()
    recordarClub('Slug Invalido', storage)
    expect(clubRecordado(storage)).toBeNull()
  })

  it('clubRecordado descarta un valor inválido que haya quedado guardado (versión vieja, manipulación manual)', () => {
    const storage = createFakeStorage({ pamir_club_preferido: '../etc/passwd' })
    expect(clubRecordado(storage)).toBeNull()
  })

  it('un storage que lanza (modo privado) nunca rompe ninguna de las dos', () => {
    const storage = createThrowingStorage()
    expect(() => recordarClub('pamir', storage)).not.toThrow()
    expect(() => clubRecordado(storage)).not.toThrow()
    expect(clubRecordado(storage)).toBeNull()
  })
})

describe('clubPreferido', () => {
  it('la URL gana sobre lo recordado', () => {
    const storage = createFakeStorage()
    recordarClub('pamir', storage)
    expect(clubPreferido({ search: '?club=el-montanista', storage })).toBe('el-montanista')
  })

  it('sin slug en la URL, cae a lo recordado', () => {
    const storage = createFakeStorage()
    recordarClub('pamir', storage)
    expect(clubPreferido({ search: '', storage })).toBe('pamir')
  })

  it('un slug inválido en la URL se descarta y cae a lo recordado (no se queda en el limbo)', () => {
    const storage = createFakeStorage()
    recordarClub('pamir', storage)
    expect(clubPreferido({ search: '?club=Invalido', storage })).toBe('pamir')
  })

  it('null sin ninguno de los dos', () => {
    expect(clubPreferido({ search: '', storage: createFakeStorage() })).toBeNull()
  })
})
