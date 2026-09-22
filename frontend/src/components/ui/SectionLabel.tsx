import type { ReactNode } from 'react'

interface SectionLabelProps {
  children: ReactNode
  /** Acción opcional alineada a la derecha (p. ej. el enlace "Historial"). */
  action?: ReactNode
  className?: string
}

/**
 * Encabezado de sección en versalitas (token `label-caps`).
 *
 * Es un rótulo de agrupación, no un encabezado de documento: por eso NO emite
 * un <h2>/<h3>, que rompería la jerarquía secuencial de headings de la página
 * y le daría a un lector de pantalla puntos de navegación falsos.
 */
export function SectionLabel({ children, action, className = '' }: SectionLabelProps) {
  return (
    <div className={['flex items-center justify-between gap-3 mb-3', className].filter(Boolean).join(' ')}>
      <span className="text-label-caps uppercase tracking-[0.1em] text-on-surface-variant/80">{children}</span>
      {action}
    </div>
  )
}
