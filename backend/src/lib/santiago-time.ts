/**
 * UTC offset of America/Santiago for a calendar date (DST-safe). A noon-UTC
 * probe avoids the midnight DST transition edge.
 */
export function santiagoOffsetFor(dateStr: string): string {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    timeZoneName: 'longOffset',
  }).formatToParts(probe);
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-04:00';
  return tzPart.replace('GMT', '');
}

/**
 * Instant for a Santiago wall-clock time ("YYYY-MM-DD" + "HH:MM"). Throws
 * instead of returning an Invalid Date, so callers never compare against NaN
 * (historical years yield offsets with seconds, which the ISO parser rejects).
 */
export function instanteSantiago(fecha: string, hora: string): Date {
  const instante = new Date(`${fecha}T${hora}:00${santiagoOffsetFor(fecha)}`);
  if (Number.isNaN(instante.getTime())) {
    throw new RangeError(`Fecha u hora inválida para Santiago: ${fecha} ${hora}`);
  }
  return instante;
}
