// Recuperación de un chunk lazy que no se pudo traer (evento `vite:preloadError`,
// ver main.tsx). Vive acá, sin tocar el DOM, para poder probar la decisión.

export const PRELOAD_RELOAD_KEY = 'riala_preload_reload_at'

// Ventana en la que no se vuelve a recargar solo: si el chunk sigue sin llegar
// justo después de una recarga, el problema no es un hash viejo y recargar otra
// vez solo armaría un bucle.
export const PRELOAD_RELOAD_WINDOW_MS = 10_000

export interface ReloadStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface Decision {
  now: number
  /** Cuándo fue la última recarga automática, o null si no hubo ninguna. */
  lastReloadAt: number | null
  online: boolean
}

// Solo se recarga solo si hay red (el caso real: un deploy dejó obsoleto el hash
// de una pestaña ya abierta, y recargar trae el index.html nuevo). Sin red
// recargar reemplazaría la app en marcha por la página de "sin conexión" del
// navegador y perdería el estado en memoria, sin traer nada: el chunk seguiría
// sin llegar. Tampoco se recarga si ya se hizo hace poco.
export function shouldAutoReload({ now, lastReloadAt, online }: Decision): boolean {
  if (!online) return false
  if (lastReloadAt === null) return true
  // `now - lastReloadAt` negativo (reloj atrasado) cae dentro de la ventana: sin recarga.
  return now - lastReloadAt >= PRELOAD_RELOAD_WINDOW_MS
}

// Decide Y deja registrada la recarga, para que la próxima decisión la vea.
// Si no se puede leer o escribir sessionStorage (modo privado, cuota, política
// del navegador) no hay cómo evitar un bucle de recargas: se prefiere no
// recargar y dejar que el error llegue a la pantalla de error.
export function claimAutoReload({
  now,
  online,
  getStorage,
}: {
  now: number
  online: boolean
  getStorage: () => ReloadStorage
}): boolean {
  try {
    const storage = getStorage()
    const stored = storage.getItem(PRELOAD_RELOAD_KEY)
    const parsed = stored === null ? Number.NaN : Number(stored)
    const lastReloadAt = Number.isFinite(parsed) ? parsed : null
    if (!shouldAutoReload({ now, lastReloadAt, online })) return false
    storage.setItem(PRELOAD_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}
