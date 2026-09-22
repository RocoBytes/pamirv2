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
  /**
   * Onda de confirmación que cubre el viewport entero (ver SuccessReveal).
   *
   * Es el único valor del archivo que toca el techo de 400ms descrito arriba,
   * y a propósito: la regla de "por encima de 400ms se lee como espera" está
   * pensada para elementos que recorren decenas de píxeles. Acá el círculo
   * recorre media pantalla en diagonal, y a 280ms el movimiento se lee como un
   * salto en vez de como algo que crece.
   */
  reveal: 0.4,
} as const

/** Desaceleración al entrar. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const
/** Aceleración al salir. */
export const EASE_IN = [0.7, 0, 0.84, 0] as const
/**
 * Curva de la onda que cubre la pantalla (ver SuccessReveal).
 *
 * `EASE_OUT` no sirve acá y está medido: es tan pronunciada que recorre el 85%
 * del camino en el primer 20% del tiempo. En un elemento chico eso se lee como
 * reflejos rápidos, pero en un círculo que tapa el viewport significa que la
 * pantalla ya está verde a los 130ms y el resto de la animación crece fuera de
 * cuadro sin que se vea nada — un parpadeo, no una onda.
 *
 * Esta arranca más contenida y frena al final: el crecimiento se ve.
 */
export const EASE_REVEAL = [0.4, 0, 0.2, 1] as const

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

/** Hacia dónde se mueve la navegación; no dice nada sobre la velocidad. */
export type Direction = 'forward' | 'back'

/**
 * Fábrica común de `screenVariants` y `stepVariants`: un desplazamiento en X
 * con opacidad, con el signo dado por la dirección.
 *
 * Lo único que separa una "pantalla" de un "paso" es cuánto dura y cuánto se
 * desplaza, así que eso entra por parámetro en vez de repetir la forma de las
 * variantes en dos lugares que después se desincronizan.
 */
function directionalVariants(direction: Direction, distance: number, duration: number): Variants {
  const from = direction === 'forward' ? distance : -distance
  return {
    hidden: { opacity: 0, x: from },
    visible: { opacity: 1, x: 0, transition: { duration, ease: EASE_OUT } },
    exit: { opacity: 0, x: -from, transition: { duration: duration * 0.65, ease: EASE_IN } },
  }
}

/**
 * Transición direccional entre pantallas.
 *
 * La dirección lleva significado: avanzar entra desde la derecha y volver desde
 * la izquierda, que es la convención de toda app con pila de navegación. Si la
 * dirección fuera siempre la misma, el movimiento sería decorativo y el usuario
 * perdería la noción de dónde está parado dentro del recorrido.
 */
export function screenVariants(direction: Direction): Variants {
  return directionalVariants(direction, 24, DURATION.surface)
}

/**
 * Transición direccional entre PASOS de un wizard.
 *
 * Misma idea y mismo significado de la dirección que `screenVariants`, pero más
 * corta y con menos recorrido: un paso es un fragmento dentro de una página, no
 * una pantalla entera, y lo más chico se mueve más rápido.
 *
 * El motivo concreto es la cadencia: un wizard se recorre tocando "Siguiente"
 * cuatro veces seguidas, y con `AnimatePresence mode="wait"` la salida y la
 * entrada se suman. Con `surface` cada cambio costaría ~460ms y la quinta vez
 * se siente lento; con `base` queda en ~360ms.
 */
export function stepVariants(direction: Direction): Variants {
  const distance = 20
  return {
    ...directionalVariants(direction, distance, DURATION.base),
    // La salida es una variante DINÁMICA, y no por gusto. Con
    // `AnimatePresence`, el paso que se va se sigue dibujando desde una copia
    // guardada, con la dirección que tenía cuando ENTRÓ. Medido: al tocar
    // "Anterior", el paso viejo se iba igual hacia la izquierda y el nuevo
    // entraba también desde la izquierda — una cinta transportadora en vez de
    // un retroceso. Pasando `custom={direction}` en el <AnimatePresence>, la
    // salida se recalcula con la dirección actual. Si nadie pasa `custom`, el
    // valor por defecto conserva el comportamiento anterior en vez de romper.
    exit: (exitDirection: Direction = direction) => ({
      opacity: 0,
      x: exitDirection === 'forward' ? -distance : distance,
      transition: { duration: DURATION.base * 0.65, ease: EASE_IN },
    }),
  }
}
