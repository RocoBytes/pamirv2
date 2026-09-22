import { getFileStorage } from './get-file-storage.js';
import { isObjectKey } from './object-key.js';

/**
 * Borra un objeto del storage sin lanzar nunca — pensado para llamarse
 * "fire and forget" desde los controladores (reemplazo de GPX/pronóstico,
 * borrado de documento/itinerario/salida). Un id legado de Google Drive
 * (isObjectKey === false, Drive ya no existe) se ignora en silencio; una
 * falla real del storage solo se registra, nunca bloquea al llamador.
 */
export async function deleteStoredFileBestEffort(
  fileId: string | null | undefined,
  context: string,
): Promise<void> {
  if (!isObjectKey(fileId)) return;

  try {
    await getFileStorage().delete(fileId);
  } catch (err) {
    console.error(`[${context}] No se pudo borrar el archivo del storage:`, err);
  }
}
