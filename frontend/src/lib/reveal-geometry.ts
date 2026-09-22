/**
 * Geometría de la onda de confirmación (ver components/ui/SuccessReveal).
 *
 * La matemática vive acá, separada del DOM, porque es lo único de la onda que
 * se puede testear: vitest corre en Node y no hay jsdom en este proyecto.
 */

/** Punto en coordenadas de viewport — el mismo sistema que `getBoundingClientRect`. */
export interface RevealOrigin {
  x: number
  y: number
}

/**
 * Diámetro del círculo real que se pinta, antes de escalarlo.
 *
 * Chico a propósito: lo que el navegador rasteriza es del tamaño de la semilla,
 * y el compositor después dibuja ese mismo cuadro escalado. Dimensionar el div
 * al diámetro final sería una capa de decenas de megabytes en un teléfono para
 * pintar, al final, un color plano.
 */
export const REVEAL_SEED_DIAMETER = 48

const SEED_RADIUS = REVEAL_SEED_DIAMETER / 2

/**
 * Margen sobre el radio calculado. Chico a propósito.
 *
 * Es tentador agrandarlo "por las dudas", porque en costo de pintado sale
 * gratis. Pero sale caro en otra moneda: todo lo que el círculo crece DESPUÉS
 * de tapar la pantalla es animación que nadie ve. Medido con margen 1.5, la
 * pantalla quedaba verde a los 130ms de una animación de 400ms y los 270ms
 * restantes crecían fuera de cuadro — o sea, un parpadeo en vez de una onda.
 *
 * Así que acá solo entra el redondeo de subpíxel de `getBoundingClientRect`.
 * El otro caso —el teclado virtual cerrándose y agrandando el viewport en
 * plena expansión— lo resuelve SuccessReveal recalculando con `resize`, que es
 * donde corresponde: es un cambio real, no un error de medición.
 */
const COVER_MARGIN = 1.06

/**
 * Escala que hay que aplicarle a la semilla para que un círculo nacido en
 * `origin` cubra un viewport de `width` × `height`.
 *
 * El radio necesario es la distancia hasta la esquina más lejana. No hace falta
 * probar las cuatro: `max(x, width - x)` y `max(y, height - y)` ya eligen la
 * más lejana en cada eje.
 */
export function coverScale(origin: RevealOrigin, width: number, height: number): number {
  const dx = Math.max(origin.x, width - origin.x)
  const dy = Math.max(origin.y, height - origin.y)
  const scale = (Math.hypot(dx, dy) * COVER_MARGIN) / SEED_RADIUS
  // Un viewport de 0×0 (o un origen con NaN) daría 0 o NaN, y una escala 0
  // dejaría la pantalla sin cubrir justo cuando el usuario espera respuesta.
  // Ante una medición imposible, tapar de más es el error barato.
  return Number.isFinite(scale) && scale > 1 ? scale : 1
}

/**
 * Centro del elemento en coordenadas de viewport.
 *
 * El respaldo es el centro-abajo de la pantalla, que es donde vive el botón de
 * finalizar en los cuatro wizards: si la medición falla, la onda nace de un
 * lugar plausible en vez de saltar al centro.
 */
export function originFromElement(el: Element | null | undefined): RevealOrigin {
  const rect = el?.getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return { x: window.innerWidth / 2, y: window.innerHeight - 96 }
  }
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/**
 * Centro del botón que disparó un envío de formulario.
 *
 * `SubmitEvent.submitter` es el botón exacto que lo disparó, sin tener que
 * pasar un ref por props (Safari lo tiene desde 15.4). Si viniera nulo, el
 * respaldo busca el submit dentro del propio formulario.
 *
 * IMPORTANTE: hay que llamarla de forma SÍNCRONA dentro del `onSubmit` del
 * form. React Hook Form valida con `await` antes de entregarle el evento al
 * handler de submit válido, y para entonces el navegador ya limpió
 * `currentTarget`.
 */
export function originFromSubmitEvent(event: React.FormEvent<HTMLFormElement>): RevealOrigin {
  const submitter = (event.nativeEvent as SubmitEvent).submitter
  const fallback = event.currentTarget.querySelector('button[type="submit"]')
  return originFromElement(submitter ?? fallback)
}
