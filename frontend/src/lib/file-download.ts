import { ApiError, type DownloadUrlResponse } from './api'

/**
 * Arranca la descarga de un archivo ya resuelto a una URL (firmada de Google
 * Cloud Storage, o el visor de Drive de un registro legado). Nunca recibe una
 * URL cacheada: la firmada expira a los 10 minutos, así que quien llama a
 * esta función debe haberla pedido recién, en el mismo click.
 *
 * Evita el bloqueo de pop-ups que Safari aplica a un `window.open` ejecutado
 * después de un `await` — el escenario típico de esta app mobile-first, en
 * plena montaña:
 * - URL firmada (`expiresInSeconds !== null`): la respuesta va con
 *   `Content-Disposition: attachment`, así que basta con navegar a ella; el
 *   navegador descarga el archivo y la SPA no se recarga.
 * - Link legado de Drive (`expiresInSeconds === null`): es un visor HTML, así
 *   que se intenta abrir en una pestaña nueva; si el bloqueador de pop-ups lo
 *   corta, se cae a navegar en la misma pestaña.
 */
export function startFileDownload({ url, expiresInSeconds }: DownloadUrlResponse): void {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw new Error('La URL de descarga debe ser https')
  }

  if (expiresInSeconds !== null) {
    window.location.assign(url)
    return
  }

  const nueva = window.open(url, '_blank')
  if (nueva) {
    // Corta la referencia inversa: la pestaña de Drive no debe poder tocar esta SPA.
    nueva.opener = null
    return
  }
  window.location.assign(url)
}

/** Mensaje en español, listo para mostrar inline, a partir de un error de fetchSalidaArchivoUrl/fetchDocumentoUrl/fetchEventoItinerarioUrl. */
export function describeFileDownloadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'El archivo ya no está disponible.'
    if (err.status === 403) {
      // El backend nombra el club en el mensaje cuando corresponde. Si no
      // llegó un mensaje real (solo el fallback "HTTP 403"), se usa uno genérico.
      return /^HTTP \d+$/.test(err.message)
        ? 'No tienes permiso para descargar este archivo.'
        : err.message
    }
  }
  return 'No se pudo preparar la descarga. Inténtalo de nuevo.'
}
