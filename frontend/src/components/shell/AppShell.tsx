import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { screenVariants } from '../ui/motion'
import { AppHeader } from './AppHeader'
import { BottomNav } from './BottomNav'
import { AppFooter } from './AppFooter'
import { useIsDesktop } from '../../hooks/useMediaQuery'
import type { NavKey } from './navItems'

/**
 * Lo que toda pantalla necesita para dibujar el chrome compartido.
 *
 * Va como un solo objeto y no como props sueltas porque son siempre los mismos
 * cuatro datos: así agregar un destino no obliga a tocar la firma de cada
 * pantalla. App.tsx lo arma una vez por sesión.
 */
export interface ShellContext {
  userName: string
  canSeeDocumentos: boolean
  onLogout: () => void
  onNavigate: (key: NavKey) => void
  // undefined = la cuenta tiene una sola membresía (o clubes todavía no se
  // conoce) — AppHeader no muestra el botón. Navega con una recarga completa
  // a propósito (window.location.assign), igual que cualquier cambio de club:
  // reinicia el árbol de React contra el nuevo club en vez de intentar
  // reconciliar el estado de la sesión anterior en el cliente.
  onCambiarClub?: () => void
}

interface AppShellProps {
  shell: ShellContext
  /** Destino actual, para marcarlo en la navegación. */
  active: NavKey | 'none'
  /** Título compacto de pantalla secundaria; solo se pinta en mobile. */
  title?: string
  onBack?: () => void
  /** Ancho del contenido: el Inicio usa el grid ancho, el resto la columna. */
  width?: 'wide' | 'narrow'
  /**
   * 'focused' esconde toda la navegación global (links del header, barra
   * inferior y pie) y deja solo marca, volver y salir.
   *
   * Lo usan los formularios largos —wizard de salida, ficha de integrante,
   * ficha de cierre, edición— porque ahí un toque en "Eventos" descarta lo que
   * el usuario venía escribiendo sin pasar por la confirmación de salida que
   * esos flujos ya implementan en su propio botón "Volver".
   */
  chrome?: 'full' | 'focused'
  children: ReactNode
}

/**
 * Chrome compartido: header arriba, barra inferior en mobile, pie en desktop.
 *
 * La variante se decide en JS (useIsDesktop), no con `hidden`/`lg:block`:
 * montar las dos y esconder una dejaría dos barras de navegación en el árbol de
 * accesibilidad y dos coincidencias por cada etiqueta. Solo una llega al DOM.
 */
export function AppShell({
  shell,
  active,
  title,
  onBack,
  width = 'wide',
  chrome = 'full',
  children,
}: AppShellProps) {
  const isDesktop = useIsDesktop()
  const showNav = chrome === 'full'

  return (
    <div className="min-h-screen flex flex-col bg-alpine-canvas">
      <AppHeader
        userName={shell.userName}
        active={active}
        onNavigate={shell.onNavigate}
        canSeeDocumentos={shell.canSeeDocumentos}
        onLogout={shell.onLogout}
        onCambiarClub={shell.onCambiarClub}
        isDesktop={isDesktop}
        showNav={showNav}
        title={title}
        onBack={onBack}
      />

      {/* pb-28 en mobile reserva el alto de la barra inferior fija para que
          nunca tape el último elemento del contenido. */}
      <main
        className={[
          'w-full flex-1 mx-auto px-4 sm:px-6 py-6 sm:py-8',
          width === 'wide' ? 'max-w-5xl' : 'max-w-2xl',
          // El inset inferior solo hace falta cuando hay barra que esquivar.
          !isDesktop && showNav ? 'pb-28' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/*
          La transición de pantalla se aplica acá adentro y nunca a un envoltorio
          del shell: `transform` en un ancestro crea un bloque contenedor y
          rompería el `position: fixed` de la barra inferior y el `sticky` del
          header, que quedarían anclados al envoltorio en vez de al viewport.
          El header, la barra y el pie quedan quietos y solo se mueve el
          contenido, que además es lo que de verdad cambió.

          Ir al Inicio se lee como "volver" y salir de él como "avanzar", que es
          la jerarquía real de esta navegación: el Inicio es la raíz.
        */}
        <motion.div
          variants={screenVariants(active === 'inicio' ? 'back' : 'forward')}
          initial="hidden"
          animate="visible"
        >
          {children}
        </motion.div>
      </main>

      {showNav &&
        (isDesktop ? (
          <AppFooter />
        ) : (
          <BottomNav
            active={active}
            onNavigate={shell.onNavigate}
            canSeeDocumentos={shell.canSeeDocumentos}
          />
        ))}
    </div>
  )
}
