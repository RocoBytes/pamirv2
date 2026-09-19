import type { SalidaRecord } from '../types/salida'

/**
 * UTC offset of America/Santiago for a calendar date (DST-safe). A noon-UTC
 * probe avoids the midnight DST transition edge. Mirrors the backend helper.
 */
export function santiagoOffsetFor(dateStr: string): string {
  const probe = new Date(`${dateStr}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    timeZoneName: 'longOffset',
  }).formatToParts(probe)
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-04:00'
  return tzPart.replace('GMT', '')
}

/**
 * Scheduled departure instant of a salida, in Santiago time. `fechaInicio`
 * arrives as an ISO string stored at midnight UTC of the chosen date; `horaInicio`
 * is "HH:MM". Legacy salidas without `horaInicio` fall back to 23:59 (editable
 * through the start day).
 */
export function departureMoment(
  salida: Pick<SalidaRecord, 'fechaInicio' | 'horaInicio'>,
): Date {
  const dateStr = salida.fechaInicio.slice(0, 10)
  const hora = salida.horaInicio || '23:59'
  return new Date(`${dateStr}T${hora}:00${santiagoOffsetFor(dateStr)}`)
}

/**
 * The integrantes section is editable only while the salida is EN_CURSO and the
 * scheduled departure date+time has not been reached. Mirrors the backend gate.
 */
export function isIntegrantesEditable(
  salida: Pick<SalidaRecord, 'status' | 'fechaInicio' | 'horaInicio'>,
  now: Date = new Date(),
): boolean {
  return salida.status === 'EN_CURSO' && now < departureMoment(salida)
}
