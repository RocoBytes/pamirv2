import { useCallback, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { DownloadUrlResponse } from '../lib/api'
import { startFileDownload, describeFileDownloadError } from '../lib/file-download'

interface FileDownloadButtonProps {
  /** Pide la URL recién al hacer click: nunca se cachea (la firmada expira en 10 minutos). */
  fetchUrl: () => Promise<DownloadUrlResponse>
  /** Clases del <button>; reemplaza por completo a las del <a> que este control sustituye. */
  className: string
  /** Contenido en reposo (ícono + texto), igual al del link original. */
  children: ReactNode
  loadingLabel?: string
}

/**
 * Reemplaza a los links con href fijo de antes de la migración de
 * almacenamiento: ya no hay una URL para guardar de antemano, así que este
 * botón la pide en el momento del click y recién ahí dispara la descarga.
 */
export function FileDownloadButton({
  fetchUrl,
  className,
  children,
  loadingLabel = 'Preparando descarga…',
}: FileDownloadButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchUrl()
      startFileDownload(data)
    } catch (err) {
      setError(describeFileDownloadError(err))
    } finally {
      setLoading(false)
    }
  }, [fetchUrl])

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        aria-busy={loading}
        className={className}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin shrink-0" />
            {loadingLabel}
          </>
        ) : (
          children
        )}
      </button>
      {error && (
        <p role="status" aria-live="polite" className="text-xs text-[#8b3a44] px-1">
          {error}
        </p>
      )}
    </div>
  )
}
