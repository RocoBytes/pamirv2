import type { Transition, Variants } from 'motion/react'

/**
 * Tokens de movimiento.
 *
 * Están todos acá por la misma razón por la que los colores están en index.css:
 * si cada componente elige su propia duración, la app se siente hecha por
 * varias manos. Una pantalla tiene un ritmo o no lo tiene.
 *
 * Reglas que siguen estos valores:
 *  - Las micro-interacciones viven entre 150 y 300ms; por encima de 400ms el
 *    movimiento deja de leerse como respuesta y empieza a leerse como espera.
 *  - Salir es más rápido que entrar (~65%): una vista que se va lento da la
 *    sensación de que la app no te está haciendo caso.
 *  - Entrar usa ease-out y salir ease-in, que es cómo se mueven las cosas con
 *    inercia: arrancan rápido al llegar y aceleran al irse.
 *  - Solo se animan `transform` y `opacity`. Animar alto, ancho o posición
 *    obliga al navegador a recalcular layout en cada cuadro y provoca saltos.
 *
 * No hace falta comprobar `prefers-reduced-motion` en cada uso: el
 * <MotionConfig reducedMotion="user"> de la raíz desactiva estas animaciones
 * para quien lo tenga activado en su sistema.
 */

export const DURATION = {
  /** Respuesta inmediata: presionar, resaltar. */
  instant: 0.12,
  /** Micro-interacción estándar. */
  base: 0.22,
  /** Entrada de superficies grandes (hojas, modales, pantallas). */
  surface: 0.28,
} as const

/** Desaceleración al entrar. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const
/** Aceleración al salir. */
export const EASE_IN = [0.7, 0, 0.84, 0] as const

export const enterTransition: Transition = { duration: DURATION.surface, ease: EASE_OUT }
export const exitTransition: Transition = { duration: DURATION.surface * 0.65, ease: EASE_IN }

/** Retardo entre elementos de una lista. Por encima de ~50ms se percibe lento. */
export const STAGGER_STEP = 0.04

/**
 * Feedback táctil de una superficie presionable.
 *
 * La escala baja lo justo para que se note sin mover a los vecinos: el elemento
 * se encoge sobre su propio centro, no empuja el layout.
 */
export const pressable = {
  whileTap: { scale: 0.98 },
  transition: { duration: DURATION.instant, ease: EASE_OUT },
} as const

/** Contenedor de una lista que revela sus hijos de a uno. */
export const listContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: STAGGER_STEP } },
}

/** Hijo de `listContainer`: entra desde abajo, que sugiere "esto acaba de llegar". */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: enterTransition },
}

/** Telón de fondo de una hoja o modal. */
export const scrim: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.base } },
  exit: { opacity: 0, transition: { duration: DURATION.base * 0.65 } },
}

/** Hoja inferior (mobile): sube desde el borde. */
export const bottomSheet: Variants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: enterTransition },
  exit: { y: '100%', transition: exitTransition },
}

/** Diálogo centrado: aparece creciendo desde su propio centro. */
export const dialog: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: enterTransition },
  exit: { opacity: 0, scale: 0.96, transition: exitTransition },
}

/**
 * Transición direccional entre pantallas.
 *
 * La dirección lleva significado: avanzar entra desde la derecha y volver desde
 * la izquierda, que es la convención de toda app con pila de navegación. Si la
 * dirección fuera siempre la misma, el movimiento sería decorativo y el usuario
 * perdería la noción de dónde está parado dentro del recorrido.
 */
export function screenVariants(direction: 'forward' | 'back'): Variants {
  const from = direction === 'forward' ? 24 : -24
  return {
    hidden: { opacity: 0, x: from },
    visible: { opacity: 1, x: 0, transition: enterTransition },
    exit: { opacity: 0, x: -from, transition: exitTransition },
  }
}
