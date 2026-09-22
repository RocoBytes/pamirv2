import type { Direction } from '../components/ui/motion'

/**
 * Hacia dónde va la transición entre dos pasos de un wizard.
 *
 * Se deriva en vez de declararse. Un wizard cambia de paso desde muchos lados
 * —Siguiente, Atrás, un salto de validación que vuelve a un paso anterior, la
 * restauración de un borrador que abre directo en el paso 4, la bifurcación que
 * saltea un paso entero— y pedirle a cada uno de esos lugares que además avise
 * la dirección es garantizar que al próximo que se agregue se le olvide.
 *
 * Un salto hacia un paso MAYOR es "forward" aunque saltee pasos; hacia uno
 * MENOR es "back". Quedarse en el mismo paso conserva la última dirección: es
 * un re-render cualquiera, no un movimiento.
 */
export function directionBetween(previous: number, next: number, last: Direction): Direction {
  if (next > previous) return 'forward'
  if (next < previous) return 'back'
  return last
}
