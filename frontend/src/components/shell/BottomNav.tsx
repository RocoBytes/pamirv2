import { visibleNavItems, type NavKey } from './navItems'

interface BottomNavProps {
  active: NavKey | 'none'
  onNavigate: (key: NavKey) => void
  canSeeDocumentos: boolean
}

/**
 * Barra de navegación inferior (solo mobile).
 *
 * Cada destino lleva icono Y etiqueta: un icono solo es adivinanza, sobre todo
 * para quien entra por primera vez. Los objetivos táctiles son de 64x56 px con
 * separación, holgados para dedos con guantes o frío — el caso de uso real.
 */
export function BottomNav({ active, onNavigate, canSeeDocumentos }: BottomNavProps) {
  const items = visibleNavItems(canSeeDocumentos)

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed bottom-0 inset-x-0 z-40 pb-safe bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/40 shadow-[0_-2px_12px_rgba(15,31,61,0.06)]"
    >
      <div className="flex justify-around items-center h-20 px-1 max-w-2xl mx-auto">
        {items.map((item) => {
          const isActive = item.key === active
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'flex flex-col items-center justify-center gap-1 min-w-[64px] h-14 rounded-xl px-2',
                'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                item.emergency
                  ? 'text-error active:bg-error-container/50'
                  : isActive
                    ? 'text-primary'
                    : 'text-on-surface-variant active:bg-surface-container-low',
              ].join(' ')}
            >
              <Icon size={24} aria-hidden="true" />
              <span
                className={[
                  'text-label-caps uppercase tracking-[0.05em]',
                  isActive || item.emergency ? 'font-bold' : 'font-semibold',
                ].join(' ')}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
