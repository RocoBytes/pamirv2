import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { Button } from './ui/Button'
import { ErrorCard } from './ui/ErrorCard'

// Red de seguridad de la aplicación entera: lo que se ve si algo falla al
// renderizar FUERA de una pantalla lazy (esas tienen la suya, en LazyScreen).
// "Reintentar" vuelve a renderizar sin recargar; recargar solo se ofrece con
// red, porque sin ella reemplazaría la app por la página de "sin conexión" del
// navegador.
export function AppErrorScreen({ onRetry }: { onRetry: () => void }) {
  const online = useOnlineStatus()
  return (
    <ErrorCard
      message={
        online
          ? 'Algo salió mal al mostrar la aplicación.'
          : 'Sin conexión: algo salió mal al mostrar la aplicación. Vuelve a intentarlo cuando tengas señal.'
      }
    >
      <Button fullWidth onClick={onRetry}>
        Reintentar
      </Button>
      {online && (
        <Button variant="ghost" fullWidth onClick={() => window.location.reload()}>
          Recargar la app
        </Button>
      )}
    </ErrorCard>
  )
}
