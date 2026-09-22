// Los campos *FileUrl de Salida nunca deben salir en una respuesta HTTP: el
// bucket es privado y la URL se firma bajo demanda (ver GET
// /api/salidas/:id/archivos/:tipo/url). Los campos *FileId/*FileName sí se
// exponen — el frontend los usa para saber si hay un archivo y pedir su URL.
// No usa destructuring con resto para no chocar con
// @typescript-eslint/no-unused-vars (ignoreRestSiblings no está habilitado).
export function serializeSalida<T extends { gpxFileUrl?: unknown; pronosticoFileUrl?: unknown }>(
  salida: T,
): Omit<T, 'gpxFileUrl' | 'pronosticoFileUrl'> {
  const clone: Record<string, unknown> = { ...salida };
  delete clone.gpxFileUrl;
  delete clone.pronosticoFileUrl;
  return clone as Omit<T, 'gpxFileUrl' | 'pronosticoFileUrl'>;
}
