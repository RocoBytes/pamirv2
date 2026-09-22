import { useEffect, useState } from 'react'

/**
 * Estado de conexión real del navegador.
 *
 * Reemplaza al indicador decorativo "Basecamp Conectado" del boceto: en una app
 * que se usa camino a la montaña, saber si todavía hay señal antes de intentar
 * registrar una salida es información operativa, no adorno.
 *
 * `navigator.onLine` solo garantiza que hay una interfaz de red activa (puede
 * dar true sin internet real), así que se usa para avisar "sin conexión" —
 * nunca para bloquear una acción.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === 'undefined') return true
    return navigator.onLine
  })

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return isOnline
}
