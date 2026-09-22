import { Lock, ShieldCheck, CircleCheckBig } from 'lucide-react'
import { motion } from 'motion/react'
import { pressable } from '../ui/motion'
import { cardSurface, cardInteractive } from '../ui/Card'

interface HeroCierreCardProps {
  /** Disponible solo si el usuario tiene ficha y lidera/creó alguna salida. */
  available: boolean
  /** Sin ficha de integrante: cambia el motivo del bloqueo. */
  locked: boolean
  isDesktop: boolean
  onClick: () => void
}

export function HeroCierreCard({ available, locked, isDesktop, onClick }: HeroCierreCardProps) {
  if (!available) {
    // justify-center: en el grid esta tarjeta se estira a la altura de la de
    // salida, que es bastante más alta; sin centrar el contenido quedaría
    // pegado arriba con un hueco muerto debajo.
    return (
      <div
        className={`${cardSurface} p-6 sm:p-7 flex flex-col justify-center gap-3`}
        aria-label="Ficha de cierre bloqueada"
      >
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl bg-surface-container border border-outline-variant/50 flex items-center justify-center shrink-0">
            <Lock size={18} className="text-outline" aria-hidden="true" />
          </span>
          <span className="text-label-caps uppercase tracking-[0.05em] font-bold text-on-surface-variant/70">
            Post-Salida
          </span>
        </div>
        <h2 className="text-headline-md font-extrabold tracking-tight text-on-surface/70">
          Ficha de Cierre
        </h2>
        <p className="text-body-sm text-on-surface-variant max-w-sm">
          {locked
            ? 'Registra tu primera salida para desbloquear esta sección'
            : 'Solo puedes cerrar actividades que hayas liderado/creado'}
        </p>
      </div>
    )
  }

  // Variante mobile: una fila compacta. La acción de cierre no compite en peso
  // con la de registrar salida — sube el que ya volvió, no el que va a salir.
  if (!isDesktop) {
    return (
      <motion.button
        type="button"
        onClick={onClick}
        whileTap={pressable.whileTap}
        transition={pressable.transition}
        aria-label="Abrir ficha de cierre de actividad"
        className={`${cardSurface} ${cardInteractive} w-full p-4 flex items-center justify-between gap-3 text-left`}
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl bg-pine-container flex items-center justify-center shrink-0">
            <ShieldCheck size={20} className="text-pine" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-title-md font-semibold text-on-surface leading-tight">
              Cierre de Retorno
            </span>
            <span className="block text-body-sm text-on-surface-variant truncate">
              ¿Regresaste? Cancela la alerta
            </span>
          </span>
        </span>
        <span className="shrink-0 h-9 px-3 rounded-lg bg-surface-container-high text-on-surface text-body-medium font-semibold flex items-center">
          Notificar
        </span>
      </motion.button>
    )
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={pressable.whileTap}
      transition={pressable.transition}
      aria-label="Abrir ficha de cierre de actividad"
      className={`${cardSurface} ${cardInteractive} group w-full text-left p-6 sm:p-7 flex flex-col justify-between gap-6`}
    >
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container border border-outline-variant/50 text-on-surface-variant text-label-caps font-bold uppercase tracking-[0.05em]">
            <ShieldCheck size={13} className="text-pine" aria-hidden="true" />
            Regreso Seguro
          </span>
        </div>

        <h2 className="text-headline-lg font-extrabold tracking-tight text-on-surface mb-2">
          Ficha de Cierre &amp; Retorno
        </h2>
        <p className="text-body-sm text-on-surface-variant leading-relaxed max-w-md">
          Notifica tu llegada de vuelta para cancelar la ventana de emergencia y registrar las
          novedades de la ruta realizada.
        </p>
      </div>

      <div className="pt-4 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-3">
        <span className="text-body-sm text-on-surface-variant">Solo salidas a tu nombre</span>
        <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-alpine-dark text-white text-body-medium font-bold tracking-wide transition-colors group-hover:bg-alpine-edge">
          <CircleCheckBig size={18} className="text-pine-container" aria-hidden="true" />
          Cerrar Registro
        </span>
      </div>
    </motion.button>
  )
}
