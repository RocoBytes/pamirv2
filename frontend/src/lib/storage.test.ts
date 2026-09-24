import { describe, expect, it } from 'vitest'
import {
  saveAuth,
  loadAuth,
  clearAuth,
  isAuthRemembered,
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
  migrateUnkeyedDraftToCurrentClub,
} from './storage'
import { clubRecordado } from './club-preferido'
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

// establishSession ahora decide entre dos storages (local vs session): sin
// jsdom no hay window.localStorage/sessionStorage reales, así que todo
// establishSession de este archivo inyecta ambos explícitamente. `local` es
// siempre el storage bajo prueba salvo que el test diga lo contrario.
function establish(
  next: { user: User; token: string },
  local: Storage,
  overrides?: { remember?: boolean; session?: Storage },
) {
  establishSession(next, { local, session: overrides?.session ?? createFakeStorage(), remember: overrides?.remember })
}

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

// ─── loadAuth / clearAuth con el par {session, local} ────────────────────────
// Sin argumento, ambas operan sobre sessionStorage + localStorage reales; acá
// se prueba ese camino con un par inyectado (ver isStoragePair en storage.ts).

describe('loadAuth / clearAuth (par session + local)', () => {
  it('loadAuth prefiere sessionStorage sobre localStorage cuando ambos tienen un registro', () => {
    const session = createFakeStorage()
    const local = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-session' }, session)
    saveAuth({ user: USER_B, token: 'tok-local' }, local)

    expect(loadAuth({ session, local })).toEqual({ user: USER_A, token: 'tok-session' })
  })

  it('loadAuth cae a localStorage cuando sessionStorage no tiene registro', () => {
    const session = createFakeStorage()
    const local = createFakeStorage()
    saveAuth({ user: USER_B, token: 'tok-local' }, local)

    expect(loadAuth({ session, local })).toEqual({ user: USER_B, token: 'tok-local' })
  })

  it('loadAuth devuelve null si ninguno de los dos tiene registro', () => {
    expect(loadAuth({ session: createFakeStorage(), local: createFakeStorage() })).toBeNull()
  })

  it('clearAuth con el par limpia AMBOS storages', () => {
    const session = createFakeStorage()
    const local = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-session' }, session)
    saveAuth({ user: USER_B, token: 'tok-local' }, local)

    clearAuth({ session, local })

    expect(loadAuth(session)).toBeNull()
    expect(loadAuth(local)).toBeNull()
  })
})

// ─── isAuthRemembered ─────────────────────────────────────────────────────────

describe('isAuthRemembered', () => {
  it('true cuando el registro está en local (no en session)', () => {
    const session = createFakeStorage()
    const local = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-1' }, local)
    expect(isAuthRemembered({ session, local })).toBe(true)
  })

  it('false cuando el registro está en session', () => {
    const session = createFakeStorage()
    const local = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-1' }, session)
    expect(isAuthRemembered({ session, local })).toBe(false)
  })

  it('true por defecto cuando no hay ningún registro todavía', () => {
    expect(isAuthRemembered({ session: createFakeStorage(), local: createFakeStorage() })).toBe(true)
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

// ─── Claves por club (Tarea 7: multi-club) ────────────────────────────────────
// clubSlugFromPath NO se importa acá a propósito: estos tests manejan el
// keying por club enteramente a través del parámetro `slug` que exponen
// saveDraft/loadDraft/clearDraft — resolver el slug desde la URL es
// responsabilidad de los call sites reales (WizardLayout.tsx), no de storage.ts.

describe('per-club draft/integrantes keys', () => {
  it('saveDraft/loadDraft usan una clave por club cuando se pasa un slug', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'A' }, storage, 'el-montanista')
    saveDraft({ nombreActividad: 'B' }, storage, 'riala')
    expect(loadDraft(storage, 'el-montanista')).toEqual({ nombreActividad: 'A' })
    expect(loadDraft(storage, 'riala')).toEqual({ nombreActividad: 'B' })
  })

  it('sin slug, usa la clave sin club de siempre (compatibilidad)', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Sin club' }, storage)
    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Sin club' })
  })

  it('clearDraft con slug no borra el draft de otro club', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'A' }, storage, 'el-montanista')
    saveDraft({ nombreActividad: 'B' }, storage, 'riala')
    clearDraft(storage, 'el-montanista')
    expect(loadDraft(storage, 'el-montanista')).toBeNull()
    expect(loadDraft(storage, 'riala')).toEqual({ nombreActividad: 'B' })
  })
})

describe('migrateUnkeyedDraftToCurrentClub', () => {
  it('mueve un draft SIN club (guardado antes de esta fase) a la clave del club actual', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Draft viejo' }, storage)
    saveDraftStep(2, storage)

    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')

    expect(loadDraft(storage, 'el-montanista')).toEqual({ nombreActividad: 'Draft viejo' })
    expect(loadDraftStep(storage, 'el-montanista')).toBe(2)
    expect(loadDraft(storage)).toBeNull()
  })

  it('no hace nada si no hay draft sin club', () => {
    const storage = createFakeStorage()
    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')
    expect(loadDraft(storage, 'el-montanista')).toBeNull()
  })

  it('no hace nada si ya existe un draft en la clave del club actual (nunca lo pisa)', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Viejo sin club' }, storage)
    saveDraft({ nombreActividad: 'Ya en el club actual' }, storage, 'el-montanista')

    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')

    expect(loadDraft(storage, 'el-montanista')).toEqual({ nombreActividad: 'Ya en el club actual' })
    // El draft viejo sin club se conserva intacto: no se migró (destino
    // ocupado) y tampoco se borró (nadie pierde una ficha en curso).
    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Viejo sin club' })
  })

  it('correr la migración dos veces es un no-op la segunda vez (idempotente)', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Draft viejo' }, storage)

    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')
    saveDraft({ nombreActividad: 'Nuevo draft sin club, después de migrar' }, storage)
    migrateUnkeyedDraftToCurrentClub(storage, 'el-montanista')

    // La segunda corrida encuentra la clave del club actual YA ocupada (por
    // la primera migración) y no la pisa con el segundo draft sin club.
    expect(loadDraft(storage, 'el-montanista')).toEqual({ nombreActividad: 'Draft viejo' })
  })

  it('no hace nada en la raíz del dominio (sin club): un no-op cuando no se pasa slug', () => {
    const storage = createFakeStorage()
    saveDraft({ nombreActividad: 'Draft sin club' }, storage)
    saveDraftStep(1, storage)

    migrateUnkeyedDraftToCurrentClub(storage)

    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Draft sin club' })
    expect(loadDraftStep(storage)).toBe(1)
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
    establish({ user: USER_A, token: 'tok-a' }, storage)
    expect(loadAuth(storage)).toEqual({ user: USER_A, token: 'tok-a' })
    expect(storage.getItem('pamir_owner')).toBe('user-a')
  })

  it('mismo usuario vuelve a autenticarse: conserva el borrador y la caché de integrantes', () => {
    const storage = createFakeStorage()
    establish({ user: USER_A, token: 'tok-1' }, storage)
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)
    saveIntegrante({ id: 'int-1', nombreCompleto: 'X', rut: '1-9', email: 'x@x.cl', createdAt: '' }, storage)

    establish({ user: USER_A, token: 'tok-2' }, storage)

    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Cerro Plomo' })
    expect(loadIntegrantes(storage)).toHaveLength(1)
    expect(loadAuth(storage)).toEqual({ user: USER_A, token: 'tok-2' })
  })

  it('un usuario distinto se autentica en el mismo navegador: purga borrador y caché de integrantes', () => {
    const storage = createFakeStorage()
    establish({ user: USER_A, token: 'tok-1' }, storage)
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)
    saveIntegrante({ id: 'int-1', nombreCompleto: 'X', rut: '1-9', email: 'x@x.cl', createdAt: '' }, storage)

    establish({ user: USER_B, token: 'tok-2' }, storage)

    expect(loadDraft(storage)).toBeNull()
    expect(loadIntegrantes(storage)).toEqual([])
    expect(loadAuth(storage)).toEqual({ user: USER_B, token: 'tok-2' })
    expect(storage.getItem('pamir_owner')).toBe('user-b')
  })

  it('logout no purga nada, y el mismo usuario recuperando sesión después conserva el borrador', () => {
    const storage = createFakeStorage()
    establish({ user: USER_A, token: 'tok-1' }, storage)
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)

    // Logout real de la app: solo borra pamir_auth (ver useAuth.logout), la
    // marca de dueño se conserva a propósito.
    clearAuth(storage)

    establish({ user: USER_A, token: 'tok-2' }, storage)
    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Cerro Plomo' })
  })

  it('sin marca de dueño (navegador con una versión anterior): mismo usuario del pamir_auth guardado conserva el borrador', () => {
    const storage = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-viejo' }, storage) // pamir_auth sin pamir_owner
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)

    establish({ user: USER_A, token: 'tok-nuevo' }, storage)

    expect(loadDraft(storage)).toEqual({ nombreActividad: 'Cerro Plomo' })
    expect(storage.getItem('pamir_owner')).toBe('user-a')
  })

  it('sin marca de dueño: usuario distinto al del pamir_auth guardado purga el borrador', () => {
    const storage = createFakeStorage()
    saveAuth({ user: USER_A, token: 'tok-viejo' }, storage)
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)

    establish({ user: USER_B, token: 'tok-nuevo' }, storage)

    expect(loadDraft(storage)).toBeNull()
  })

  it('pamir_auth corrupto (JSON inválido) se trata como "sin usuario previo" y purga sin lanzar', () => {
    const storage = createFakeStorage({ pamir_auth: '{not-json' })
    saveDraft({ nombreActividad: 'Cerro Plomo' }, storage)

    expect(() => establish({ user: USER_A, token: 'tok-nuevo' }, storage)).not.toThrow()
    expect(loadDraft(storage)).toBeNull()
  })

  it('un storage que lanza (modo privado) nunca rompe el login', () => {
    const storage = createThrowingStorage()
    expect(() => establish({ user: USER_A, token: 'tok-1' }, storage)).not.toThrow()
  })

  // ── Club recordado (ver club-preferido.ts) ──────────────────────────────
  it('recuerda el club de la sesión establecida, para pintar la marca del login la próxima vez', () => {
    const storage = createFakeStorage()
    const userConOrg: User = {
      ...USER_A,
      organization: {
        id: 'org-pamir',
        slug: 'pamir',
        name: 'Andino Club Pamir',
        shortName: 'Pamir',
        membresiaPropia: 'SOCIO_ANDINO_PAMIR',
        hasLogo: false,
        logoVersion: null,
      },
    }
    establish({ user: userConOrg, token: 'tok-1' }, storage)
    expect(clubRecordado(storage)).toBe('pamir')
  })

  it('sesión sin organization resuelto aún (pamir_auth de una sesión anterior a esta fase): no toca el club recordado', () => {
    const storage = createFakeStorage()
    establish({ user: USER_A, token: 'tok-1' }, storage)
    expect(clubRecordado(storage)).toBeNull()
  })
})

// ─── establishSession: "recordar este equipo" (auth en local vs session) ─────

describe('establishSession — recordar este equipo', () => {
  it('con recordar (por defecto): el registro de auth va a localStorage, no a sessionStorage', () => {
    const local = createFakeStorage()
    const session = createFakeStorage()
    establishSession({ user: USER_A, token: 'tok-1' }, { local, session, remember: true })

    expect(loadAuth(local)).toEqual({ user: USER_A, token: 'tok-1' })
    expect(loadAuth(session)).toBeNull()
  })

  it('sin recordar: el registro de auth va a sessionStorage, no a localStorage', () => {
    const local = createFakeStorage()
    const session = createFakeStorage()
    establishSession({ user: USER_A, token: 'tok-1' }, { local, session, remember: false })

    expect(loadAuth(session)).toEqual({ user: USER_A, token: 'tok-1' })
    expect(loadAuth(local)).toBeNull()
  })

  it('el borrador y el club recordado nunca se mueven a sessionStorage, con o sin recordar', () => {
    const local = createFakeStorage()
    const session = createFakeStorage()
    const userConOrg: User = {
      ...USER_A,
      organization: {
        id: 'org-pamir',
        slug: 'pamir',
        name: 'Andino Club Pamir',
        shortName: 'Pamir',
        membresiaPropia: 'SOCIO_ANDINO_PAMIR',
        hasLogo: false,
        logoVersion: null,
      },
    }
    // Establece la titularidad primero (marca pamir_owner = user-a), como
    // haría un login real; recién entonces guarda el borrador de ESE dueño.
    establishSession({ user: userConOrg, token: 'tok-0' }, { local, session, remember: false })
    saveDraft({ nombreActividad: 'Cerro Plomo' }, local)

    establishSession({ user: userConOrg, token: 'tok-1' }, { local, session, remember: false })

    // El borrador del mismo dueño se conserva, y solo en local.
    expect(loadDraft(local)).toEqual({ nombreActividad: 'Cerro Plomo' })
    expect(loadDraft(session)).toBeNull()
    // pamir_owner y el club recordado también quedan solo en local.
    expect(local.getItem('pamir_owner')).toBe('user-a')
    expect(session.getItem('pamir_owner')).toBeNull()
    expect(clubRecordado(local)).toBe('pamir')
    expect(clubRecordado(session)).toBeNull()
  })

  it('cambiar de "no recordar" a "recordar" no deja un registro huérfano en sessionStorage', () => {
    const local = createFakeStorage()
    const session = createFakeStorage()
    establishSession({ user: USER_A, token: 'tok-1' }, { local, session, remember: false })
    expect(loadAuth(session)).not.toBeNull()

    establishSession({ user: USER_A, token: 'tok-2' }, { local, session, remember: true })

    expect(loadAuth(local)).toEqual({ user: USER_A, token: 'tok-2' })
    expect(loadAuth(session)).toBeNull()
  })

  it('cambiar de "recordar" a "no recordar" no deja un registro huérfano en localStorage', () => {
    const local = createFakeStorage()
    const session = createFakeStorage()
    establishSession({ user: USER_A, token: 'tok-1' }, { local, session, remember: true })
    expect(loadAuth(local)).not.toBeNull()

    establishSession({ user: USER_A, token: 'tok-2' }, { local, session, remember: false })

    expect(loadAuth(session)).toEqual({ user: USER_A, token: 'tok-2' })
    expect(loadAuth(local)).toBeNull()
  })
})
