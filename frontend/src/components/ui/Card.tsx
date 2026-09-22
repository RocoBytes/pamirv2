import type { HTMLAttributes, ReactNode } from 'react'

/**
 * Superficie base de tarjeta: blanco sobre el lienzo, borde hairline y sombra
 * ambiental difusa (Surface Tier 1 de DESIGN.md).
 *
 * Se exporta también como string porque muchas tarjetas del dashboard son
 * `<button>` clickeables completas, no `<div>`: así comparten exactamente las
 * mismas clases sin duplicar la definición ni envolver un botón en un div.
 */
export const cardSurface =
  'bg-surface-container-lowest border border-outline-variant/40 rounded-2xl shadow-[0_1px_3px_rgba(15,31,61,0.05),0_1px_2px_rgba(15,31,61,0.03)]'

/** Realce al hover para tarjetas interactivas (Surface Tier 2). */
export const cardInteractive =
  'transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,31,61,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'

type Padding = 'none' | 'sm' | 'md' | 'lg'

const paddingClasses: Record<Padding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-4 sm:p-5',
  lg: 'p-6 sm:p-7',
}

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: Padding
  children: ReactNode
}

export function Card({ padding = 'md', className = '', children, ...props }: CardProps) {
  return (
    <div className={[cardSurface, paddingClasses[padding], className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
}
