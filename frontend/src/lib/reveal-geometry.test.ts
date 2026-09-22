import { describe, expect, it } from 'vitest'
import { coverScale, REVEAL_SEED_DIAMETER } from './reveal-geometry'

const SEED_RADIUS = REVEAL_SEED_DIAMETER / 2

/** Radio que el círculo alcanza con la escala devuelta. */
function reachedRadius(scale: number): number {
  return scale * SEED_RADIUS
}

/** Distancia real del origen a cada esquina del viewport. */
function cornerDistances(x: number, y: number, w: number, h: number): number[] {
  return [
    Math.hypot(x, y),
    Math.hypot(w - x, y),
    Math.hypot(x, h - y),
    Math.hypot(w - x, h - y),
  ]
}

describe('coverScale', () => {
  it('alcanza la esquina más lejana desde el borde inferior, que es el caso real', () => {
    // El botón de finalizar vive abajo y centrado: las esquinas superiores son
    // las que mandan.
    const w = 390
    const h = 844
    const origin = { x: w / 2, y: h - 60 }

    const reached = reachedRadius(coverScale(origin, w, h))

    for (const distance of cornerDistances(origin.x, origin.y, w, h)) {
      expect(reached).toBeGreaterThan(distance)
    }
  })

  it('cubre el viewport nazca donde nazca', () => {
    const w = 1280
    const h = 720
    const origins = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: 0, y: h },
      { x: w, y: h },
      { x: w / 2, y: h / 2 },
      { x: 12, y: h - 12 },
    ]

    for (const origin of origins) {
      const reached = reachedRadius(coverScale(origin, w, h))
      for (const distance of cornerDistances(origin.x, origin.y, w, h)) {
        expect(reached).toBeGreaterThan(distance)
      }
    }
  })

  it('desde el centro necesita menos escala que desde una esquina', () => {
    const w = 390
    const h = 844

    const fromCenter = coverScale({ x: w / 2, y: h / 2 }, w, h)
    const fromCorner = coverScale({ x: 0, y: 0 }, w, h)

    expect(fromCenter).toBeLessThan(fromCorner)
  })

  it('no se pasa de largo: tapar de más es animación que nadie ve', () => {
    // Todo lo que el círculo crece después de tapar la pantalla ocurre fuera
    // de cuadro. Con un margen de 1.5 la pantalla quedaba verde a los 130ms de
    // una animación de 400ms — un parpadeo. El margen cubre el redondeo de
    // subpíxel y nada más; el teclado virtual lo resuelve SuccessReveal
    // recalculando con `resize`.
    const w = 390
    const h = 844
    const origin = { x: w / 2, y: h - 60 }

    const worstCorner = Math.max(...cornerDistances(origin.x, origin.y, w, h))
    const reached = reachedRadius(coverScale(origin, w, h))

    expect(reached).toBeGreaterThan(worstCorner)
    expect(reached).toBeLessThan(worstCorner * 1.1)
  })

  it('ante una medición imposible tapa de más en vez de no tapar nada', () => {
    // Una escala 0 o NaN dejaría al usuario mirando el formulario intacto
    // justo cuando espera la confirmación.
    expect(coverScale({ x: 0, y: 0 }, 0, 0)).toBe(1)
    expect(coverScale({ x: Number.NaN, y: 0 }, 390, 844)).toBe(1)
  })
})
