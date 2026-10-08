import { describe, expect, it } from 'vitest'
import {
  claimAutoReload,
  PRELOAD_RELOAD_KEY,
  PRELOAD_RELOAD_WINDOW_MS,
  shouldAutoReload,
  type ReloadStorage,
} from './preload-recovery'

const NOW = 1_000_000

describe('shouldAutoReload', () => {
  it('con red y sin recarga previa: recarga', () => {
    expect(shouldAutoReload({ now: NOW, lastReloadAt: null, online: true })).toBe(true)
  })

  it('sin red nunca recarga, ni siquiera la primera vez', () => {
    expect(shouldAutoReload({ now: NOW, lastReloadAt: null, online: false })).toBe(false)
  })

  it('dentro de la ventana desde la última recarga: no recarga', () => {
    expect(shouldAutoReload({ now: NOW, lastReloadAt: NOW - 1, online: true })).toBe(false)
    expect(shouldAutoReload({ now: NOW, lastReloadAt: NOW - PRELOAD_RELOAD_WINDOW_MS + 1, online: true })).toBe(false)
  })

  it('pasada la ventana: vuelve a recargar', () => {
    expect(shouldAutoReload({ now: NOW, lastReloadAt: NOW - PRELOAD_RELOAD_WINDOW_MS, online: true })).toBe(true)
    expect(shouldAutoReload({ now: NOW, lastReloadAt: NOW - PRELOAD_RELOAD_WINDOW_MS - 1, online: true })).toBe(true)
  })

  it('con el reloj atrasado (última recarga "en el futuro") no recarga', () => {
    expect(shouldAutoReload({ now: NOW, lastReloadAt: NOW + 5_000, online: true })).toBe(false)
  })

  it('sin red tampoco recarga aunque la última recarga sea antigua', () => {
    expect(shouldAutoReload({ now: NOW, lastReloadAt: NOW - 10 * PRELOAD_RELOAD_WINDOW_MS, online: false })).toBe(false)
  })
})

function memoryStorage(initial: Record<string, string> = {}): ReloadStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('claimAutoReload', () => {
  it('primer fallo con red: recarga y deja registrada la hora', () => {
    const storage = memoryStorage()
    expect(claimAutoReload({ now: NOW, online: true, getStorage: () => storage })).toBe(true)
    expect(storage.data[PRELOAD_RELOAD_KEY]).toBe(String(NOW))
  })

  it('un segundo fallo dentro de la ventana no recarga ni pisa la hora registrada', () => {
    const storage = memoryStorage()
    claimAutoReload({ now: NOW, online: true, getStorage: () => storage })
    expect(claimAutoReload({ now: NOW + 1_000, online: true, getStorage: () => storage })).toBe(false)
    expect(storage.data[PRELOAD_RELOAD_KEY]).toBe(String(NOW))
  })

  it('pasada la ventana vuelve a recargar y actualiza la hora', () => {
    const storage = memoryStorage()
    claimAutoReload({ now: NOW, online: true, getStorage: () => storage })
    const later = NOW + PRELOAD_RELOAD_WINDOW_MS
    expect(claimAutoReload({ now: later, online: true, getStorage: () => storage })).toBe(true)
    expect(storage.data[PRELOAD_RELOAD_KEY]).toBe(String(later))
  })

  it('sin red no recarga y no escribe nada', () => {
    const storage = memoryStorage()
    expect(claimAutoReload({ now: NOW, online: false, getStorage: () => storage })).toBe(false)
    expect(storage.data).toEqual({})
  })

  it('un valor guardado ilegible se trata como "nunca recargó"', () => {
    const storage = memoryStorage({ [PRELOAD_RELOAD_KEY]: 'no-es-un-numero' })
    expect(claimAutoReload({ now: NOW, online: true, getStorage: () => storage })).toBe(true)
  })

  it('si sessionStorage no existe o lanza al obtenerlo: no recarga (evita un bucle)', () => {
    const getStorage = () => {
      throw new Error('SecurityError')
    }
    expect(claimAutoReload({ now: NOW, online: true, getStorage })).toBe(false)
  })

  it('si leer lanza: no recarga', () => {
    const storage: ReloadStorage = {
      getItem: () => {
        throw new Error('boom')
      },
      setItem: () => {},
    }
    expect(claimAutoReload({ now: NOW, online: true, getStorage: () => storage })).toBe(false)
  })

  it('si escribir lanza (cuota llena): no recarga, porque no podría recordar que ya lo hizo', () => {
    const storage: ReloadStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(claimAutoReload({ now: NOW, online: true, getStorage: () => storage })).toBe(false)
  })
})
