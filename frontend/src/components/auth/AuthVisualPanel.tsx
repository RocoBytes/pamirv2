import { useState } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'

// Panel visual de la columna derecha en el login (oculto bajo `lg`, ver el
// shell en AuthPage.tsx). El degradado alpine-dark-from → alpine-dark-to
// está SIEMPRE presente; el video (o, en su defecto, la imagen fija) es un
// realce opcional encima. Cascada de tres escalones, cada uno bajando al
// siguiente sin romper — mismo patrón que ClubLogo.tsx:
//   video (autoplay, loop, mute) → imagen fija /auth/panel.jpg (poster del
//   video, y fallback si el video falla) → degradado solo.
// prefers-reduced-motion salta directo al segundo escalón: sin autoplay de
// video para quien pidió menos movimiento. alt/src nunca pueden mencionar el
// club: es decorativa (aria-hidden).
export function AuthVisualPanel() {
  const [videoFailed, setVideoFailed] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  const showVideo = !prefersReducedMotion && !videoFailed
  const showImage = !imageFailed

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-alpine-dark-from to-alpine-dark-to">
      {showVideo && showImage && (
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster="/auth/panel.jpg"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          // Los errores de un <source> hijo no burbujean al elemento <video>:
          // hay que escuchar onError en ambos para que cualquiera de los dos
          // baje al escalón de la imagen fija.
          onError={() => setVideoFailed(true)}
        >
          <source src="/auth/panel.mp4" type="video/mp4" onError={() => setVideoFailed(true)} />
        </video>
      )}
      {!showVideo && showImage && (
        <img
          src="/auth/panel.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      )}
    </div>
  )
}
