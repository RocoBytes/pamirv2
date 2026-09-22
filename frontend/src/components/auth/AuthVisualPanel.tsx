import { useState } from 'react'

// Panel visual de la columna derecha en el login (oculto bajo `lg`, ver el
// shell en AuthPage.tsx). El degradado alpine-dark-from → alpine-dark-to
// está SIEMPRE presente; la imagen es un realce opcional encima. Si
// /auth/panel.jpg no existe o falla la carga, onError la oculta y queda el
// degradado — mismo patrón de cascada que ClubLogo.tsx (bajar un escalón en
// vez de romper). alt/src nunca pueden mencionar el club: es decorativa.
export function AuthVisualPanel() {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-alpine-dark-from to-alpine-dark-to">
      {!imageFailed && (
        // Reemplazo por video: cambiar este <img> por, por ejemplo,
        //   <video src="/auth/panel.mp4" autoPlay loop muted playsInline
        //     className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
        // conservando el mismo `alt`/aria-hidden y el estado de cascada.
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
