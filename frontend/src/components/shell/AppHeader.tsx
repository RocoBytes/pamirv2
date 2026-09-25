import { LogOut, RefreshCw, ChevronLeft, Wifi, WifiOff } from 'lucide-react'
import { ClubLogo } from '../ClubLogo'
import { Button } from '../ui/Button'
import { useOrganization } from '../../hooks/useOrganization'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { userInitials } from './userInitials'
import { applyOrder, visibleNavItems, type NavKey } from './navItems'
import { useNavPreferences } from '../../hooks/useNavPreferences'

interface AppHeaderProps {
  userName: string
  active: NavKey | 'none'
  onNavigate: (key: NavKey) => void
  canSeeDocumentos: boolean
  onLogout: () => void
  onCambiarClub?: () => void
  isDesktop: boolean
  /** false en flujos enfocados (formularios largos): sin links de navegación. */
  showNav: boolean
  /** Título de pantalla secundaria; en el Inicio va vacío. */
  title?: string
  onBack?: () => void
}

function ConnectionChip({ compact }: { compact: boolean }) {
  const isOnline = useOnlineStatus()

  // El estado no viaja solo en el color: lleva icono y texto propios, para que
  // se entienda sin distinguir verde de ámbar.
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-[0.05em] text-label-caps',
        compact ? 'px-1.5 py-0.5' : 'px-2.5 py-1',
        isOnline
          ? 'bg-pine-container text-pine border-pine/25'
          : 'bg-amber-50 text-amber-800 border-amber-300',
      ].join(' ')}
    >
      {isOnline ? <Wifi size={12} aria-hidden="true" /> : <WifiOff size={12} aria-hidden="true" />}
      {isOnline ? 'Conectado' : 'Sin conexión'}
    </span>
  )
}

export function AppHeader({
  userName,
  active,
  onNavigate,
  canSeeDocumentos,
  onLogout,
  onCambiarClub,
  isDesktop,
  showNav,
  title,
  onBack,
}: AppHeaderProps) {
  const { shortName } = useOrganization()
  const initials = userInitials(userName)
  const { preferences } = useNavPreferences()
  const navItems = applyOrder(visibleNavItems(canSeeDocumentos), preferences?.tabs)

  return (
    <header className="sticky top-0 z-40 bg-surface-container-lowest/90 backdrop-blur-md border-b border-outline-variant/40 shadow-sm pt-safe">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Marca del club — nunca un wordmark de producto: la app es
            white-label y cada club ve solo lo suyo (ver lib/club-brand.ts). */}
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Volver"
              className="shrink-0 -ml-1 w-10 h-10 flex items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-container-low transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeft size={22} />
            </button>
          )}

          <div className="flex items-center gap-2.5 min-w-0">
            <ClubLogo alt="" className="w-10 h-10 object-contain shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="font-extrabold text-headline-md tracking-tight text-primary leading-none truncate">
                {shortName}
              </span>
              {!isDesktop && (
                <span className="mt-1">
                  <ConnectionChip compact />
                </span>
              )}
            </div>
          </div>

          {isDesktop && (
            <>
              <span className="h-4 w-px bg-outline-variant/60 shrink-0" aria-hidden="true" />
              <ConnectionChip compact={false} />
            </>
          )}
        </div>

        {/* Navegación central — solo desktop; en mobile vive en la barra inferior.
            Se mantiene también en pantallas secundarias: el botón "volver" no
            puede ser la única salida de una vista profunda. En mobile ese rol lo
            cumple la barra inferior, así que ahí el espacio va para el título. */}
        {isDesktop && showNav && (
          <nav aria-label="Navegación principal" className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = item.key === active
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate(item.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'px-3 py-1.5 rounded-lg font-bold text-body-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    isActive
                      ? 'bg-surface-container text-primary'
                      : item.emergency
                        ? 'text-error hover:bg-error-container/50'
                        : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-low',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>
        )}

        {/* Título compacto: ocupa el centro del header solo cuando ahí no va la
            navegación — en mobile siempre, y en desktop en los flujos enfocados.
            Con navegación visible el título vive en el cuerpo de la página. */}
        {title && (!isDesktop || !showNav) && (
          <h1 className="flex-1 min-w-0 text-center text-title-md sm:text-headline-md font-bold text-on-surface truncate">
            {title}
          </h1>
        )}

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isDesktop && (
            <span className="text-body-sm font-bold text-on-surface leading-none max-w-[14rem] truncate">
              {userName}
            </span>
          )}
          <span
            aria-hidden="true"
            className="w-9 h-9 rounded-full bg-primary-fixed text-on-primary-fixed border border-primary/15 flex items-center justify-center font-bold text-body-sm shrink-0"
          >
            {initials}
          </span>
          {onCambiarClub && (
            <Button variant="ghost" size="sm" onClick={onCambiarClub} aria-label="Cambiar de club">
              <RefreshCw size={16} />
              <span className="hidden sm:inline">Cambiar de club</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onLogout} aria-label="Cerrar sesion">
            <LogOut size={16} />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
