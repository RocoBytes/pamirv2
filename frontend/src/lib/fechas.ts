import { z } from 'zod'

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/
export const ANIO_MINIMO = 2000
export const ANIO_MAXIMO = 2100

// A date input emits padded intermediate values while the year is being typed
// ("2" -> "0002-09-24"); only a plausible 4-digit year counts as complete.
export function esFechaCompleta(fecha: string): boolean {
  if (!FORMATO_FECHA.test(fecha)) return false
  const anio = Number(fecha.slice(0, 4))
  return anio >= ANIO_MINIMO && anio <= ANIO_MAXIMO
}

// Year-safe: Date.UTC would map years 0-99 to 1900-1999.
export function restarDias(fecha: string, dias: number): string {
  const [y = 0, m = 1, d = 1] = fecha.split('-').map(Number)
  const base = new Date(0)
  base.setUTCFullYear(y, m - 1, d - dias)
  return base.toISOString().slice(0, 10)
}

export const MENSAJE_FECHA_INVALIDA = 'Fecha inválida: revisa el año (4 dígitos)'

// Required date input: non-empty, then a complete plausible calendar date.
export function fechaInputField(mensajeVacio: string) {
  return z.string().min(1, mensajeVacio).refine(esFechaCompleta, MENSAJE_FECHA_INVALIDA)
}
