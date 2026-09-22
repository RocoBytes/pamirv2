import { useState } from 'react'
import type { Direction } from '../components/ui/motion'
import { directionBetween } from '../lib/step-direction'

/**
 * Dirección de la transición del wizard, derivada del paso actual.
 *
 * Le basta con recibir el paso: compara contra el último paso confirmado y
 * deduce si el movimiento fue para adelante o para atrás. Ningún lugar que
 * llame `setCurrentStep` tiene que cambiar (ver el porqué en
 * lib/step-direction).
 *
 * Usa el patrón de React de *ajustar estado durante el render*: cuando el paso
 * no coincide con el último que se vio, se recalcula y se guarda ahí mismo, y
 * se devuelve el valor nuevo en este mismo render. No con un `useRef` mutado
 * en un efecto, que es la forma obvia y está mal por dos motivos: leer un ref
 * durante el render rompe con el compilador de React (la regla
 * `react-hooks/refs` lo rechaza), y en StrictMode el render doble corrompe la
 * comparación.
 */
export function useStepDirection(step: number): Direction {
  const [tracked, setTracked] = useState<{ step: number; direction: Direction }>({
    step,
    direction: 'forward',
  })

  if (step !== tracked.step) {
    const direction = directionBetween(tracked.step, step, tracked.direction)
    setTracked({ step, direction })
    return direction
  }

  return tracked.direction
}
