import type { ReactNode } from 'react'

/**
 * Chip de estado / acreditación.
 *
 * `tone` es semántico, no decorativo:
 *   neutral  — metadato sin carga (borrador, "Al día")
 *   cobalt   — marca / pertenencia (insignia de socio, ADMIN)
 *   pine     — validado, cerrado, completado
 *   rescue   — acción o aviso operativo (pre-salida)
 *   error    — emergencia y SOS, nada más
 *   onDark   — sobre una superficie alpine-dark
 *
 * Nunca lleva el significado solo en el color: el texto del chip siempre dice
 * qué es, para que no dependa de la percepción cromática.
 */
type Tone = 'neutral' | 'cobalt' | 'pine' | 'rescue' | 'error' | 'onDark'

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-container text-on-surface-variant border-outline-variant/50',
  cobalt: 'bg-primary-fixed text-on-primary-fixed border-primary/15',
  pine: 'bg-pine-container text-pine border-pine/20',
  rescue: 'bg-rescue-soft text-rescue-strong border-rescue/25',
  error: 'bg-error-container text-on-error-container border-error/20',
  onDark: 'bg-white/10 text-rescue border-white/15',
}

type Shape = 'pill' | 'tag'

const shapeClasses: Record<Shape, string> = {
  pill: 'rounded-full px-2.5 py-0.5',
  tag: 'rounded-md px-1.5 py-0.5',
}

interface BadgeProps {
  tone?: Tone
  shape?: Shape
  icon?: ReactNode
  className?: string
  children: ReactNode
}

export function Badge({ tone = 'neutral', shape = 'pill', icon, className = '', children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 shrink-0 border uppercase tracking-[0.05em] font-bold text-label-caps',
        toneClasses[tone],
        shapeClasses[shape],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
      {children}
    </span>
  )
}
