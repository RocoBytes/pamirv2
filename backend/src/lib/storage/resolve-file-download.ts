import { isObjectKey, objectKeyBelongsTo } from './object-key.js';

export interface FileDownloadRow {
  fileId: string | null;
  legacyUrl: string | null;
  downloadName: string;
}

export type FileDownloadResolution =
  | { kind: 'signed'; key: string; downloadName: string }
  | { kind: 'legacy'; url: string }
  | { kind: 'mismatch'; key: string }
  | { kind: 'absent' };

/**
 * Decide, a partir de una fila (Salida/Documento/Evento), qué responder para
 * su endpoint de URL de descarga. Pura — no toca el storage ni el request —
 * así que los tres endpoints (salidas, documentos, eventos) comparten la
 * misma decisión probada una sola vez:
 *
 * - id column con forma de clave de objeto y perteneciente al club → signed.
 * - id column con forma de clave de objeto pero de OTRO club → mismatch (el
 *   llamador la trata como 404 y registra la discrepancia; nunca debería
 *   ocurrir salvo un bug, defensa en profundidad).
 * - id column sin forma de clave de objeto (legado de Google Drive) pero con
 *   una URL legada guardada → legacy (los enlaces viejos de Drive siguen
 *   funcionando).
 * - ninguno de los anteriores → absent (nada que descargar).
 */
export function resolveFileDownload(row: FileDownloadRow, organizationId: string): FileDownloadResolution {
  if (isObjectKey(row.fileId)) {
    return objectKeyBelongsTo(row.fileId, organizationId)
      ? { kind: 'signed', key: row.fileId, downloadName: row.downloadName }
      : { kind: 'mismatch', key: row.fileId };
  }
  if (row.legacyUrl) {
    return { kind: 'legacy', url: row.legacyUrl };
  }
  return { kind: 'absent' };
}
