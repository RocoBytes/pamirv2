import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { renderQrSvg, svgToDataUrl } from '../../lib/qr'

interface QrCodeProps {
  value: string
  size?: number
  alt: string
  className?: string
}

type QrState = { value: string; kind: 'ok'; src: string } | { value: string; kind: 'failed' }

/**
 * Un <img> con el QR de `value`, renderizado como SVG y pintado por `src`
 * (data URL) — nunca `dangerouslySetInnerHTML` (evita inyectar el SVG crudo
 * en el DOM) ni un servicio remoto de terceros (ver el comentario de
 * lib/qr.ts). Reutilizado por el banner de una invitación individual
 * (InvitacionesManager.tsx) y, más adelante, por el QR reusable del club.
 */
export function QrCode({ value, size = 160, alt, className }: QrCodeProps) {
  // Guardado junto al `value` con el que se generó (no dos estados sueltos):
  // así, cuando `value` cambia, el resultado anterior deja de "pertenecer" a
  // este render sin necesitar un setState síncrono al inicio del efecto para
  // limpiarlo — evita el patrón que react-hooks/set-state-in-effect marca
  // (setState solo ocurre dentro de los callbacks async de abajo).
  const [state, setState] = useState<QrState | null>(null)

  useEffect(() => {
    let cancelled = false

    renderQrSvg(value)
      .then((svg) => {
        if (cancelled) return
        setState({ value, kind: 'ok', src: svgToDataUrl(svg) })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[QrCode] No se pudo generar el código QR:', err)
        setState({ value, kind: 'failed' })
      })

    return () => {
      cancelled = true
    }
  }, [value])

  const current = state?.value === value ? state : null

  if (current?.kind === 'failed') return null

  if (!current) {
    return (
      <div
        role="status"
        aria-label="Generando código QR"
        className={className}
        style={{ width: size, height: size }}
      >
        <div className="flex h-full w-full items-center justify-center rounded-lg bg-surface-container-low">
          <Loader2 size={20} className="animate-spin text-on-surface-variant" />
        </div>
      </div>
    )
  }

  return <img src={current.src} alt={alt} width={size} height={size} className={className} />
}
