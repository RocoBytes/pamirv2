import { Component, type ReactNode } from 'react'
import { Button } from './Button'

interface RouteErrorBoundaryProps {
  children: ReactNode
}

interface RouteErrorBoundaryState {
  failed: boolean
}

// Red de seguridad del árbol entero: sin un límite de error, cualquier fallo de
// render (en particular, un chunk lazy que no llega porque se cayó la señal o
// porque hubo un deploy y el hash viejo ya no existe — ver main.tsx) deja la
// pantalla en blanco. Acá se muestra un mensaje con una salida: recargar.
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="min-h-screen bg-alpine-canvas flex items-center justify-center px-4">
        <div
          role="alert"
          className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-secondary/15 p-6 text-center"
        >
          <p className="text-sm text-slate-700 mb-5">
            No se pudo mostrar esta pantalla. Revisa tu conexión e inténtalo de nuevo.
          </p>
          <Button fullWidth onClick={() => window.location.reload()}>
            Reintentar
          </Button>
        </div>
      </div>
    )
  }
}
