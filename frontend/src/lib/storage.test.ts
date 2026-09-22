import { describe, expect, it } from 'vitest'
import {
  saveAuth,
  loadAuth,
  clearAuth,
  saveDraft,
  loadDraft,
  saveDraftStep,
  loadDraftStep,
  clearDraft,
  saveIntegrante,
  loadIntegrantes,
  clearIntegrantesCache,
  decideDraftOwnership,
  establishSession,
} from './storage'
import type { User } from '../types/salida'

// ─── Doble de prueba de Storage (sin jsdom) ──────────────────────────────────

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

const USER_A: User = { id: 'user-a', name: 'Alpinista A', email: 'a@example.com' }
const USER_B: User = { id: 'user-b', name: 'Alpinista B', email: 'b@example.com' }

// ─── saveAuth / loadAuth / clearAuth ──────────────────────────────────────────

describe('saveAuth / loadAuth / clearAuth', () => {
  it('guarda y recupera user + token', () => {
    const storage = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-1' }, storage)
    expect(loadAuth(storage)).toEqual({ user: USER_A, token: 'tok-1' })
  })

  it('loadAuth devuelve null si no hay nada guardado', () => {
    expect(loadAuth(createFakeStorage())).toBeNull()
  })

  it('loadAuth devuelve null ante JSON corrupto, sin lanzar', () => {
    const storage = createFakeStorage({ pamir_auth: '{not-json' })
    expect(loadAuth(storage)).toBeNull()
  })

  it('clearAuth elimina la sesión guardada', () => {
    const storage = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-1' }, storage)
    clearAuth(storage)
    expect(loadAuth(storage)).toBeNull()
  })

  it('un storage que lanza (modo privado) nunca rompe ninguna de las tres', () => {
    const storage = createThrowingStorage()
    expect(() => saveAuth({ user: USER_A, token: 'tok-1' }, storage)).not.toThrow()
    expect(() => loadAuth(storage)).not.toThrow()
    expect(() => clearAuth(storage)).not.toThrow()
    expect(loadAuth(storage)).toBeNull()
  })
})

// ─── Draft ────────────────────────────────────────────────────────────────────

describe('saveDraft / loadDraft / saveDraftStep / loadDraftStep / clearDraft', () => {
  it('guarda y recupera un borrador parcial', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)
    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Cerro Plomo' })
  })

  it('loadDraft devuelve null si no hay borrador', () => {
    expect(loadDraft(createFakeStorage())).toBeNull()
  })

  it('loadDraftStep devuelve 0 por defecto o ante un valor no numérico', () => {
    expect(loadDraftStep(createFakeStorage())).toBe(0)
    expect(loadDraftStep(createFakeStorage({ pamir_draft_step: 'no-es-un-numero' }))).toBe(0)
  })

  it('saveDraftStep / loadDraftStep hacen roundtrip', () => {
    const storage = createFakeStorage()
    saveDraftStep(3, storage)
    expect(loadDraftStep(storage)).toBe(3)
  })

  it('clearDraft borra tanto el borrador como el paso', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)
    saveDraftStep(2, storage)
    clearDraft(storage)
    expect(loadDraft(storage)).toBeNull()
    expect(loadDraftStep(storage)).toBe(0)
  })

  it('un storage que lanza nunca rompe el guardado ni el borrado del borrador', () => {
    const storage = createThrowingStorage()
    expect(() => saveDraft({ nombreActividad: 'x' }, storage)).not.toThrow()
    expect(() => saveDraftStep(1, storage)).not.toThrow()
    expect(() => clearDraft(storage)).not.toThrow()
  })
})

// ─── Integrantes ──────────────────────────────────────────────────────────────

describe('saveIntegrante / loadIntegrantes / clearIntegrantesCache', () => {
  const integrante = {
    id: 'int-1',
    nombreCompleto: 'Test Alpinista',
    rut: '12.345.678-9',
    email: 'test@example.com',
    createdAt: new Date().toISOString(),
  }

  it('agrega un integrante nuevo al principio de la lista', () => {
    const storage = createFakeStorage()
    saveIntegrante(integrante, storage)
    expect(loadIntegrantes(storage)).toEqual([integrante])
  })

  it('actualiza un integrante existente en vez de duplicarlo', () => {
    const storage = createFakeStorage()
    saveIntegrante(integrante, storage)
    const actualizado = { ...integrante, nombreCompleto: 'Nombre Actualizado' }
    saveIntegrante(actualizado, storage)
    expect(loadIntegrantes(storage)).toEqual([actualizado])
  })

  it('loadIntegrantes devuelve [] ante JSON corrupto o storage vacío', () => {
    expect(loadIntegrantes(createFakeStorage())).toEqual([])
    expect(loadIntegrantes(createFakeStorage({ pamir_integrantes: '{not-json' }))).toEqual([])
  })

  it('clearIntegrantesCache vacía la caché', () => {
    const storage = createFakeStorage()
    saveIntegrante(integrante, storage)
    clearIntegrantesCache(storage)
    expect(loadIntegrantes(storage)).toEqual([])
  })
})

// ─── decideDraftOwnership (helper puro) ───────────────────────────────────────

describe('decideDraftOwnership', () => {
  it('misma marca de dueño → keep', () => {
    expect(
      decideDraftOwnership({ storedOwnerId: 'user-a', previousAuthUserId: 'user-a', nextUserId: 'user-a' }),
    ).toBe('keep')
  })

  it('marca de dueño distinta → purge, sin importar previousAuthUserId', () => {
    expect(
      decideDraftOwnership({ storedOwnerId: 'user-a', previousAuthUserId: 'user-b', nextUserId: 'user-b' }),
    ).toBe('purge')
  })

  it('sin marca: mismo usuario que el último pamir_auth → keep', () => {
    expect(
      decideDraftOwnership({ storedOwnerId: null, previousAuthUserId: 'user-a', nextUserId: 'user-a' }),
    ).toBe('keep')
  })

  it('sin marca: usuario distinto al último pamir_auth → purge', () => {
    expect(
      decideDraftOwnership({ storedOwnerId: undefined, previousAuthUserId: 'user-a', nextUserId: 'user-b' }),
    ).toBe('purge')
  })

  it('sin marca y sin pamir_auth previo → purge (nunca se puede probar la misma titularidad)', () => {
    expect(
      decideDraftOwnership({ storedOwnerId: null, previousAuthUserId: undefined, nextUserId: 'user-a' }),
    ).toBe('purge')
  })
})

// ─── establishSession (integración con Storage) ──────────────────────────────

describe('establishSession', () => {
  it('primer login en un navegador nuevo: no rompe aunque no haya nada que purgar', () => {
    const storage = createFakeStorage()
    establishSession({ user: USER_A, token: 'tok-a' }, storage)
    expect(loadAuth(storage)).toEqual({ user: USER_A, token: 'tok-a' })
    expect(storage.getItem('pamir_owner')).toBe('user-a')
  })

  it('mismo usuario vuelve a autenticarse: conserva el borrador y la caché de integrantes', () => {
    const storage = createFakeStorage()
    establishSession({ user: USER_A, token: 'tok-1' }, storage)
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)
    saveIntegrante({ id: 'int-1', nombreCompleto: 'X', rut: '1-9', email: 'x@x.cl', createdAt: '' }, storage)

    establishSession({ user: USER_A, token: 'tok-2' }, storage)

    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Cerro Plomo' })
    expect(loadIntegrantes(storage)).toHaveLength(1)
    expect(loadAuth(storage)).toEqual({ user: USER_A, token: 'tok-2' })
  })

  it('un usuario distinto se autentica en el mismo navegador: purga borrador y caché de integrantes', () => {
    const storage = createFakeStorage()
    establishSession({ user: USER_A, token: 'tok-1' }, storage)
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)
    saveIntegrante({ id: 'int-1', nombreCompleto: 'X', rut: '1-9', email: 'x@x.cl', createdAt: '' }, storage)

    establishSession({ user: USER_B, token: 'tok-2' }, storage)

    expect(loadDraft(storage)).toBeNull()
    expect(loadIntegrantes(storage)).toEqual([])
    expect(loadAuth(storage)).toEqual({ user: USER_B, token: 'tok-2' })
    expect(storage.getItem('pamir_owner')).toBe('user-b')
  })

  it('logout no purga nada, y el mismo usuario recuperando sesión después conserva el borrador', () => {
    const storage = createFakeStorage()
    establishSession({ user: USER_A, token: 'tok-1' }, storage)
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)

    // Logout real de la app: solo borra pamir_auth (ver useAuth.logout), la
    // marca de dueño se conserva a propósito.
    clearAuth(storage)

    establishSession({ user: USER_A, token: 'tok-2' }, storage)
    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Cerro Plomo' })
  })

  it('sin marca de dueño (navegador con una versión anterior): mismo usuario del pamir_auth guardado conserva el borrador', () => {
    const storage = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-viejo' }, storage) // pamir_auth sin pamir_owner
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)

    establishSession({ user: USER_A, token: 'tok-nuevo' }, storage)

    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Cerro Plomo' })
    expect(storage.getItem('pamir_owner')).toBe('user-a')
  })

  it('sin marca de dueño: usuario distinto al del pamir_auth guardado purga el borrador', () => {
    const storage = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-viejo' }, storage)
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)

    establishSession({ user: USER_B, token: 'tok-nuevo' }, storage)

    expect(loadDraft(storage)).toBeNull()
  })

  it('pamir_auth corrupto (JSON inválido) se trata como "sin usuario previo" y purga sin lanzar', () => {
    const storage = createFakeStorage({ pamir_auth: '{not-json' })
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)

    expect(() => establishSession({ user: USER_A, token: 'tok-nuevo' }, storage)).not.toThrow()
    expect(loadDraft(storage)).toBeNull()
  })

  it('un storage que lanza (modo privado) nunca rompe el login', () => {
    const storage = createThrowingStorage()
    expect(() => establishSession({ user: USER_A, token: 'tok-1' }, storage)).not.toThrow()
  })
})
