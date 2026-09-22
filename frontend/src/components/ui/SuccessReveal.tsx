import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'

import { DURATION, EASE_IN, EASE_OUT, EASE_REVEAL } from './motion'
import { coverScale, REVEAL_SEED_DIAMETER, type RevealOrigin } from '../../lib/reveal-geometry'

/**
 * Estado real de la operación. La onda nunca muestra el check por tiempo
 * transcurrido: solo cuando esto vale 'success'.
 */
export type RevealStatus = 'saving' | 'success' | 'error'

/**
 * Cuándo puede empezar a entrar el check, medido desde el clic.
 *
 * Arranca 80ms ANTES de que el círculo termine de expandirse: si esperara a
 * que la expansión cierre, se leerían dos eventos separados —primero se pinta,
 * después aparece un cartel— en vez de uno solo.
 */
const CHECK_GATE_MS = DURATION.reveal * 1000 - 80

/** Cuánto queda "¡Listo!" en pantalla antes de avisar que se puede navegar. */
const HOLD_MS = 650

/**
 * Cuánto se espera antes de ofrecer la salida manual, medido desde el montaje.
 *
 * Es un bote salvavidas, no un botón del diseño: la onda tapa la pantalla
 * entera, así que si algo se traba —una animación que nunca termina, un
 * `onAnimationComplete` que no llega, una petición colgada— el usuario queda
 * encerrado sin forma de ir a ningún lado. En el camino feliz este botón NO
 * llega a aparecer nunca: el componente se desmonta solo cerca de los 970ms.
 */
const ESCAPE_AFTER_MOUNT_MS = 1500

/**
 * Margen extra cuando la confirmación ya está en pantalla.
 *
 * Sin esto, un servidor que responde entre los 850ms y los 1500ms hacía
 * aparecer el botón un instante antes de que el componente se fuera solo: un
 * parpadeo de "algo salió mal" en un flujo que estaba saliendo bien. Al
 * reiniciar la cuenta cuando llega la confirmación, el botón solo aparece si
 * el desmontaje de verdad no ocurrió.
 */
const ESCAPE_GRACE_MS = 600

interface SuccessRevealProps {
  /** Centro del botón que disparó el envío, en coordenadas de viewport. */
  origin: RevealOrigin
  status: RevealStatus
  /** Texto grande junto al check. */
  title: string
  /** Detalle chico debajo (ej: "Salida N° 42 registrada"). */
  detail?: string
  /** Se anuncia mientras el servidor no confirmó nada. */
  savingLabel?: string
  /** Tras el tiempo de lectura de la confirmación. Reemplaza los setTimeout históricos. */
  onFinished: () => void
  /** Tras terminar de retraerse por error: recién ahí el formulario vuelve a ser usable. */
  onRetracted: () => void
}

/**
 * Onda de confirmación: un círculo verde nace del botón que se acaba de tocar,
 * cubre la pantalla y muestra el resultado.
 *
 * SE DIBUJA EN UN PORTAL A `document.body`, SIEMPRE. No es opcional: el cuerpo
 * de cada paso del wizard va envuelto en un `motion.div` con `transform`, y un
 * `transform` en un ancestro crea un bloque contenedor que rompe
 * `position: fixed` en sus descendientes. En el árbol, este overlay quedaría
 * anclado al envoltorio del paso en vez del viewport.
 *
 * SE ANIMA CON `transform: scale`, NO CON `clip-path: circle()`. `clip-path`
 * todavía no está acelerado por el compositor en Chrome: obliga a pintar una
 * máscara de recorte en cada cuadro. `transform` y `opacity` son las únicas
 * propiedades que se componen de forma fiable, y esta app se usa con guantes
 * en un teléfono de gama media.
 *
 * HONESTIDAD: la expansión arranca con el clic, pero el check espera la
 * confirmación real del servidor. Si la subida tarda, el verde se sostiene
 * diciendo "Guardando…"; si falla, la onda se retrae y devuelve el formulario
 * con su error. Nunca dice "¡Listo!" de algo que no se guardó.
 */
export function SuccessReveal({
  origin,
  status,
  title,
  detail,
  savingLabel = 'Guardando…',
  onFinished,
  onRetracted,
}: SuccessRevealProps) {
  // Única parte de la app que pregunta por `prefers-reduced-motion` a mano. El
  // <MotionConfig reducedMotion="user"> de App.tsx no alcanza acá: apaga los
  // transform pero deja la opacidad, así que la escala se anularía y el círculo
  // SALTARÍA a tamaño completo — un destello verde seco, justo lo peor para
  // quien pidió menos movimiento.
  const reducedMotion = useReducedMotion() ?? false

  // El ORIGEN queda congelado en el clic —la onda nace de donde estuvo el dedo,
  // no persigue al botón si el layout se mueve— pero la ESCALA se recalcula si
  // la ventana cambia de tamaño antes de quedar tapada.
  const [scale, setScale] = useState(() =>
    coverScale(origin, window.innerWidth, window.innerHeight),
  )
  const [gateOpen, setGateOpen] = useState(false)
  const [covered, setCovered] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)

  const retracting = status === 'error'
  const showSuccess = !retracting && status === 'success' && gateOpen
  const showSaving = !retracting && !showSuccess && covered

  useEffect(() => {
    const id = setTimeout(() => setGateOpen(true), CHECK_GATE_MS)
    return () => clearTimeout(id)
  }, [])

  // El caso real no es alguien girando el teléfono en pleno toque: es el
  // teclado virtual cerrándose. Tocar el botón desenfoca el campo, y en Android
  // eso devuelve ~40% del alto de la ventana mientras la onda todavía está en
  // vuelo. Motion reapunta una animación en curso sin saltos, así que alcanza
  // con recalcular. Se deja de escuchar apenas la pantalla quedó tapada: a
  // partir de ahí, crecer más no cambia nada de lo que se ve.
  useEffect(() => {
    if (covered || retracting) return
    const recompute = () =>
      setScale(coverScale(origin, window.innerWidth, window.innerHeight))
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [covered, retracting, origin])

  // El aviso de "ya se puede navegar" se dispara UNA vez por confirmación, y
  // para eso la cuenta no puede depender de la identidad de `onFinished`.
  //
  // Casi todos los llamadores pasan una flecha inline (`() => onComplete()`),
  // que es un objeto nuevo en cada render. Con `onFinished` en las
  // dependencias, cada render del formulario cancelaba el timeout y empezaba
  // otro de cero: medido, la onda del registro de integrante seguía tapando la
  // pantalla a los 3,5s y no se iba nunca. El wizard de salidas se salvaba de
  // casualidad, solo porque pasa una función estable.
  //
  // Guardar el callback en un ref y depender solo de `showSuccess` hace que el
  // componente funcione sin pedirle al que lo usa que memorice nada. Que la
  // pantalla quede tapada para siempre es demasiado caro para dejarlo atado a
  // una convención que el llamador puede no seguir.
  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  })

  useEffect(() => {
    if (!showSuccess) return
    const id = setTimeout(() => onFinishedRef.current(), HOLD_MS)
    return () => clearTimeout(id)
  }, [showSuccess])

  // La cuenta se reinicia al llegar la confirmación (ver ESCAPE_GRACE_MS), así
  // que el botón solo aparece si el desmontaje automático no ocurrió cuando
  // debía. Si está retrocediendo no hace falta: el formulario ya vuelve solo.
  const [escapeVisible, setEscapeVisible] = useState(false)
  useEffect(() => {
    if (retracting) return
    const delay = showSuccess ? HOLD_MS + ESCAPE_GRACE_MS : ESCAPE_AFTER_MOUNT_MS
    const id = setTimeout(() => setEscapeVisible(true), delay)
    return () => clearTimeout(id)
  }, [showSuccess, retracting])

  // La onda tapa el formulario entero: sin mover el foco, el teclado seguiría
  // recorriendo campos invisibles. Al desmontarse por un error, el foco vuelve
  // al botón que lo disparó.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement
    containerRef.current?.focus()
    return () => {
      const previous = previouslyFocusedRef.current
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus()
      }
    }
  }, [])

  function handleBackdropAnimationComplete() {
    if (retracting) onRetracted()
    else setCovered(true)
  }

  const backdropTransition = retracting
    ? { duration: DURATION.base * 0.65, ease: EASE_IN }
    : reducedMotion
      ? { duration: DURATION.surface, ease: EASE_OUT }
      : { duration: DURATION.reveal, ease: EASE_REVEAL }

  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      // `overflow-hidden` importa: el círculo escalado se sale del viewport y
      // sin esto el documento se llenaría de barras de scroll.
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden px-6 focus:outline-none"
    >
      {reducedMotion ? (
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 bg-pine"
          initial={{ opacity: 0 }}
          animate={{ opacity: retracting ? 0 : 1 }}
          transition={backdropTransition}
          onAnimationComplete={handleBackdropAnimationComplete}
        />
      ) : (
        <motion.div
          aria-hidden="true"
          className="absolute rounded-full bg-pine"
          style={{
            width: REVEAL_SEED_DIAMETER,
            height: REVEAL_SEED_DIAMETER,
            left: origin.x - REVEAL_SEED_DIAMETER / 2,
            top: origin.y - REVEAL_SEED_DIAMETER / 2,
            willChange: 'transform',
          }}
          initial={{ scale: 0 }}
          animate={{ scale: retracting ? 0 : scale }}
          transition={backdropTransition}
          onAnimationComplete={handleBackdropAnimationComplete}
        />
      )}

      {/* La región en vivo es el propio contenido visible, no una copia
          `sr-only` aparte: duplicar el texto lo deja dos veces en el DOM, y
          cualquier búsqueda por texto —la de un test, la de un usuario con
          "buscar en la página"— encuentra dos coincidencias. Alcanza con que
          este contenedor exista desde el montaje y vacío: el lector de
          pantalla anuncia cuando el contenido CAMBIA, y acá cambia dos veces
          (a "Guardando…" y después a la confirmación). */}
      <div
        role="status"
        aria-live="polite"
        className="relative flex items-center justify-center"
      >
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            key="success"
            className="relative flex flex-col items-center gap-4 text-center"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: DURATION.surface, ease: EASE_OUT }}
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-white/15">
              <Check size={36} strokeWidth={3} className="text-white" aria-hidden="true" />
            </div>
            <p className="text-2xl font-extrabold text-white">{title}</p>
            {detail && <p className="text-sm font-medium text-white/85">{detail}</p>}
          </motion.div>
        )}

        {showSaving && (
          <motion.div
            key="saving"
            className="relative flex items-center gap-2 text-sm font-medium text-white/85"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.base }}
          >
            <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            {savingLabel}
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* Salida de emergencia. Va FUERA de la región viva de arriba: no es
          parte de la confirmación y no tiene por qué anunciarse junto con
          ella. Hace exactamente lo mismo que haría el desmontaje automático
          —llama al mismo callback— así que no puede llevar a un lugar distinto
          del que lleva el flujo normal, por más raro que sea el estado en el
          que aparezca.

          Deliberadamente discreto: si se ve, algo ya salió mal, pero sigue sin
          ser la acción principal de la pantalla. */}
      <AnimatePresence>
        {escapeVisible && !retracting && (
          <motion.button
            key="escape"
            type="button"
            onClick={() => onFinishedRef.current()}
            className="absolute bottom-12 inline-flex items-center gap-2 rounded-xl border border-white/40 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-pine hover:bg-white/10 transition-colors"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.surface, ease: EASE_OUT }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Volver al inicio
          </motion.button>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
