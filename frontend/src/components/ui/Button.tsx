import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverted' | 'rescue'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  children: ReactNode
  fullWidth?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-primary-hover focus-visible:ring-primary disabled:bg-primary/40',
  secondary:
    'bg-surface-container-low text-primary hover:bg-surface-container focus-visible:ring-secondary border border-outline-variant/50 disabled:bg-surface-container-low/60 disabled:text-primary/50',
  ghost:
    'bg-transparent text-on-surface-variant hover:bg-surface-container-low focus-visible:ring-outline disabled:text-on-surface-variant/40',
  danger:
    'bg-error text-on-error hover:bg-on-error-container focus-visible:ring-error disabled:bg-error/40',
  inverted:
    'bg-alpine-dark text-white hover:bg-alpine-edge focus-visible:ring-alpine-dark disabled:bg-alpine-dark/50',
  // Naranja de rescate a `rescue-strong` (5.06:1 sobre blanco): en este
  // componente las etiquetas nunca llegan al umbral de texto grande, así que el
  // `rescue` brillante no puede ser el fondo. Ver el contrato de contraste en
  // index.css; el CTA grande del hero lo aplica aparte, con su propio tamaño.
  rescue:
    'bg-rescue-strong text-white hover:bg-rescue focus-visible:ring-rescue-strong disabled:bg-rescue-strong/40',
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled ?? loading}
      className={[
        'inline-flex items-center justify-center rounded-xl font-semibold',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" size={16} />}
      {children}
    </button>
  )
}
