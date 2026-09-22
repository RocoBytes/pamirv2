import { Lock, MapPinPlus, Timer, ArrowRight } from 'lucide-react'
import { motion } from 'motion/react'
import { pressable } from '../ui/motion'
import { useOrganization } from '../../hooks/useOrganization'

interface HeroSalidaCardProps {
  locked: boolean
  isDesktop: boolean
  onClick: () => void
}

/** Lienzo nocturno compartido por los dos estados de la tarjeta. */
const NIGHT_SURFACE =
  'relative overflow-hidden rounded-2xl border border-alpine-edge bg-gradient-to-br from-alpine-dark-from via-primary to-alpine-dark-to text-white shadow-lg'

/**
 * Acción principal de la app: declarar la salida antes de subir.
 *
 * El fondo es un degradado, no la foto remota de Unsplash que había antes: una
 * imagen externa en la acción más importante es una petición de red más, un
 * salto de layout y una dependencia de terceros para algo puramente decorativo.
 *
 * La tarjeta entera es el botón (no un botón anidado dentro de una tarjeta
 * clickeable): así el objetivo táctil es todo el bloque y no hay controles
 * anidados. El bloque naranja es un <span> con aspecto de botón, no un control.
 */
export function HeroSalidaCard({ locked, isDesktop, onClick }: HeroSalidaCardProps) {
  const { shortName } = useOrganization()

  if (locked) {
    return (
      <div
        className={`${NIGHT_SURFACE} p-6 sm:p-7 opacity-90`}
        aria-label="Formulario de salida bloqueado"
      >
        <div className="relative z-10 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
              <Lock size={18} className="text-white/70" aria-hidden="true" />
            </span>
            <span className="text-label-caps uppercase tracking-[0.05em] font-bold text-white/50">
              {shortName}
            </span>
          </div>
          <h2 className="text-headline-md font-extrabold tracking-tight text-white/80">
            Formulario de Salida
          </h2>
          <p className="text-body-sm text-white/60 max-w-sm">
            Completa tu ficha de integrante para desbloquear
          </p>
        </div>
      </div>
    )
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={pressable.whileTap}
      transition={pressable.transition}
      aria-label="Abrir formulario de salida"
      className={`${NIGHT_SURFACE} group w-full text-left p-6 sm:p-7 flex flex-col justify-between gap-6 transition-shadow duration-200 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rescue focus-visible:ring-offset-2`}
    >
      {/* Resplandor de rescate: decorativo, detrás del contenido. */}
      <span
        aria-hidden="true"
        className="absolute -right-12 -bottom-12 w-52 h-52 rounded-full bg-rescue/15 blur-3xl pointer-events-none"
      />

      <div className="relative z-10">
        <div className="flex items-center justify-between gap-3 mb-4">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 border border-white/15 text-rescue text-label-caps font-bold uppercase tracking-[0.05em]">
            <MapPinPlus size={13} aria-hidden="true" />
            Aviso Pre-Salida
          </span>
          <span className="text-label-caps uppercase tracking-[0.05em] font-bold text-white/50 truncate">
            {shortName}
          </span>
        </div>

        <h2 className="text-headline-lg font-extrabold tracking-tight text-white mb-2">
          {isDesktop ? 'Formulario de Salida' : 'Registrar Nueva Salida'}
        </h2>
        <p className="text-body-sm text-white/70 leading-relaxed max-w-md">
          Registra tu itinerario, cordada, ventana de retorno y contactos de emergencia antes de
          perder señal celular en montaña.
        </p>
      </div>

      <div className="relative z-10 pt-4 border-t border-white/15 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-body-sm text-white/70">
          <Timer size={16} className="text-rescue" aria-hidden="true" />
          Check de alerta activo
        </span>

        {/*
          CONTRASTE: blanco sobre `rescue` da 3.21:1, que solo cumple WCAG AA en
          el umbral de texto grande (>=18.66px en negrita). Por eso la etiqueta
          va a 19px/bold y no puede achicarse: si algún día hay que reducirla,
          el fondo debe pasar a `rescue-strong`. Ver index.css.
        */}
        <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rescue text-white text-[19px] leading-none font-bold tracking-tight shadow-md transition-colors group-hover:bg-rescue-strong">
          Registrar Salida
          <ArrowRight size={18} aria-hidden="true" />
        </span>
      </div>
    </motion.button>
  )
}
