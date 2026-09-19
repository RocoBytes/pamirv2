import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverted'
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
    'bg-[#264c99] text-white hover:bg-[#1e3c7a] focus-visible:ring-[#264c99] disabled:bg-[#264c99]/40',
  secondary:
    'bg-[#edf2fb] text-[#4a6fad] hover:bg-[#dde6f7] focus-visible:ring-[#4a6fad] border border-[#4a6fad]/20 disabled:bg-[#edf2fb]/60 disabled:text-[#4a6fad]/50',
  ghost:
    'bg-transparent text-[#757874] hover:bg-[#f0f4fb] focus-visible:ring-[#757874] disabled:text-[#757874]/40',
  danger:
    'bg-[#A4636E] text-white hover:bg-[#8b3a44] focus-visible:ring-[#A4636E] disabled:bg-[#A4636E]/40',
  inverted:
    'bg-[#0f1f3d] text-white hover:bg-[#1a3060] focus-visible:ring-[#0f1f3d] disabled:bg-[#0f1f3d]/50',
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
