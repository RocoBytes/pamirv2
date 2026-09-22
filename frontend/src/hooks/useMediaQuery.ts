import { useCallback, useSyncExternalStore } from 'react'

/**
 * Suscripción a una media query.
 *
 * El dashboard elige entre su variante mobile y la desktop desde JS, no con
 * `hidden`/`lg:block`: renderizar ambas y ocultar una dejaría dos elementos con
 * el mismo `aria-label` en el DOM, lo que rompe el modo estricto de Playwright
 * (y confunde a un lector de pantalla, que sí ve las dos).
 *
 * Usa useSyncExternalStore porque matchMedia es exactamente eso: un store
 * externo. Lee el valor de forma síncrona en cada render — sin salto en el
 * primer paint — y se resuscribe solo si cambia la query, sin el setState
 * dentro de un efecto que provocaría renders en cascada.
 */
function supportsMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!supportsMatchMedia()) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => {
    // Sin matchMedia (jsdom antiguo, render fuera del navegador) se asume la
    // variante mobile, que es la que degrada mejor en una pantalla ancha.
    if (!supportsMatchMedia()) return false
    return window.matchMedia(query).matches
  }, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** Punto de corte único del shell: por debajo es mobile, desde acá es desktop. */
export const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY)
}
