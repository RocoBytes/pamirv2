import { describe, it, expect } from 'vitest'
import { applyOrder, visibleNavItems, PINNED_TABS } from './navItems'

const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

describe('applyOrder', () => {
  it('sin orden guardado devuelve la lista tal cual', () => {
    expect(applyOrder(items, undefined).map((i) => i.key)).toEqual(['a', 'b', 'c'])
    expect(applyOrder(items, []).map((i) => i.key)).toEqual(['a', 'b', 'c'])
  })

  it('reordena según el orden guardado', () => {
    expect(applyOrder(items, ['c', 'a', 'b']).map((i) => i.key)).toEqual(['c', 'a', 'b'])
  })

  it('un destino que no figura en el orden va al final, nunca desaparece', () => {
    // Es el caso de agregar un destino nuevo a la app: quien ya había
    // personalizado tiene que verlo igual.
    expect(applyOrder(items, ['c']).map((i) => i.key)).toEqual(['c', 'a', 'b'])
  })

  it('conserva el orden relativo original entre los no listados', () => {
    expect(applyOrder(items, ['b']).map((i) => i.key)).toEqual(['b', 'a', 'c'])
  })

  it('ignora claves guardadas que ya no existen', () => {
    expect(applyOrder(items, ['rutas', 'b', 'a']).map((i) => i.key)).toEqual(['b', 'a', 'c'])
  })

  it('no muta la lista recibida', () => {
    const original = [...items]
    applyOrder(items, ['c', 'b', 'a'])
    expect(items).toEqual(original)
  })
})

describe('visibleNavItems', () => {
  it('oculta Documentación a quien no es socio del club ni admin', () => {
    expect(visibleNavItems(false).map((i) => i.key)).not.toContain('documentos')
  })

  it('la muestra a quien sí puede abrirla', () => {
    expect(visibleNavItems(true).map((i) => i.key)).toContain('documentos')
  })

  it('el acceso a emergencias está siempre, se personalice lo que se personalice', () => {
    for (const canSee of [true, false]) {
      expect(visibleNavItems(canSee).map((i) => i.key)).toContain('contactos')
    }
    expect(PINNED_TABS).toContain('contactos')
  })
})
