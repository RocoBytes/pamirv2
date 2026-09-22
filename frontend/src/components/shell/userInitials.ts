/**
 * Iniciales para el avatar del header ("Rodrigo Contreras" -> "RC").
 *
 * Toma la primera y la última palabra, no las dos primeras: en nombres como
 * "María José Contreras" la inicial útil es la del apellido, no la del segundo
 * nombre. Devuelve string vacío si no hay nada usable, para que quien llame
 * decida el fallback en vez de pintar un avatar con basura.
 */
export function userInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
