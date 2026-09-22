// El campo itinerarioFileUrl de Evento nunca debe salir en una respuesta
// HTTP: el bucket es privado y la URL se firma bajo demanda (ver GET
// /api/eventos/:id/itinerario/url). itinerarioFileId/itinerarioFileName sí se
// exponen — el frontend los usa para saber si hay un adjunto y pedir su URL.
export function serializeEvento<T extends { itinerarioFileUrl?: unknown }>(
  evento: T,
): Omit<T, 'itinerarioFileUrl'> {
  const clone: Record<string, unknown> = { ...evento };
  delete clone.itinerarioFileUrl;
  return clone as Omit<T, 'itinerarioFileUrl'>;
}
