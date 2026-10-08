import { Suspense, type ReactNode } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { Button } from './ui/Button'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { ErrorCard } from './ui/ErrorCard'
import { Spinner } from './ui/Spinner'

// Envuelve UNA pantalla lazy de App.tsx: mientras llega su chunk se ve el
// Spinner, y si no llega el fallo queda acá adentro. Así un chunk que no carga
// (sin señal, o un deploy que dejó el hash viejo) no tumba el resto de la app:
// las pantallas de terreno, que viven en el bundle de entrada, siguen abiertas.
export function LazyScreen({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <ErrorBoundary fallback={() => <ScreenLoadError onBack={onBack} />}>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

// El navegador recuerda que ese chunk falló (volver a importar la misma URL
// falla de nuevo aunque ya haya red), así que no hay un "reintentar" que sirva
// sin recargar. Recargar solo se ofrece con red: sin ella reemplazaría la app en
// marcha por la página de "sin conexión" del navegador y no traería nada.
function ScreenLoadError({ onBack }: { onBack: () => void }) {
  const online = useOnlineStatus()
  return (
    <ErrorCard
      message={
        online
          ? 'No se pudo cargar esta pantalla. Puede que haya una versión nueva de la aplicación.'
          : 'Sin conexión: esta pantalla no se pudo cargar. Vuelve a intentarlo cuando tengas señal.'
      }
    >
      {online && (
        <Button fullWidth onClick={() => window.location.reload()}>
          Recargar la app
        </Button>
      )}
      <Button variant={online ? 'ghost' : 'primary'} fullWidth onClick={onBack}>
        Volver al inicio
      </Button>
    </ErrorCard>
  )
}
