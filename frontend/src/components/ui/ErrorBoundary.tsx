import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  /** Qué mostrar cuando algo de adentro lanza al renderizar. `reset` vuelve a intentar renderizar los hijos. */
  fallback: (args: { reset: () => void }) => ReactNode
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

// Límite de error genérico: sin uno, un fallo de render deja la pantalla en
// blanco. Cada uso decide qué envuelve y qué ofrece (ver LazyScreen y
// AppErrorScreen). No se reporta a ningún servicio externo; el error queda en la
// consola.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[ErrorBoundary] fallo de render', error, info.componentStack)
  }

  reset = () => {
    this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return this.props.fallback({ reset: this.reset })
  }
}
