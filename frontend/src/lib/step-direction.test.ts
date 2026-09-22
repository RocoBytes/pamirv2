import { describe, expect, it } from 'vitest'
import { directionBetween } from './step-direction'

describe('directionBetween', () => {
  it('avanzar al paso siguiente va hacia adelante', () => {
    expect(directionBetween(1, 2, 'forward')).toBe('forward')
  })

  it('volver al paso anterior va hacia atrás', () => {
    expect(directionBetween(3, 2, 'forward')).toBe('back')
  })

  it('saltear pasos sigue siendo hacia adelante', () => {
    // InscripcionModal: quien no lleva vehículo pasa del paso 1 al 3.
    expect(directionBetween(1, 3, 'forward')).toBe('forward')
  })

  it('un salto de validación a un paso muy anterior va hacia atrás', () => {
    // RegistroIntegrante: enviar con un campo inválido del paso 1 devuelve
    // desde el paso 4.
    expect(directionBetween(4, 1, 'forward')).toBe('back')
  })

  it('restaurar un borrador guardado en un paso avanzado va hacia adelante', () => {
    expect(directionBetween(1, 4, 'forward')).toBe('forward')
  })

  it('quedarse en el mismo paso conserva la última dirección', () => {
    // Un re-render por tipear en un campo no es un movimiento y no debe
    // reescribir la dirección con la que entró el paso.
    expect(directionBetween(2, 2, 'back')).toBe('back')
    expect(directionBetween(2, 2, 'forward')).toBe('forward')
  })
})
