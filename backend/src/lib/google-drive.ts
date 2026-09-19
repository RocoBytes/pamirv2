import { google } from 'googleapis';
import { Readable, Transform, TransformCallback } from 'node:stream';
import { getOAuth2Client } from './google-credentials.js';

// ─── Size Guard Stream ────────────────────────────────────────────────────────

/**
 * Transform stream que aborta si el número de bytes supera maxBytes.
 * Garantiza que nunca cargamos el archivo completo en RAM antes de rechazarlo.
 */
class SizeGuard extends Transform {
  private bytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.bytes += chunk.length;

    if (this.bytes > this.maxBytes) {
      callback(Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE' }));
      return;
    }

    this.push(chunk);
    callback();
  }
}

// ─── Drive Client Factory ─────────────────────────────────────────────────────

async function createDriveClient() {
  return google.drive({ version: 'v3', auth: await getOAuth2Client() });
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export interface UploadResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
}

/**
 * Sube un archivo a Google Drive usando Resumable Upload (streaming).
 * El archivo NUNCA se carga completo en memoria RAM: se transmite en chunks.
 *
 * @param fileStream - Stream legible del archivo (proveniente de busboy)
 * @param fileName   - Nombre con que se guardará en Drive
 * @param mimeType   - MIME type del archivo
 * @param maxBytes   - Límite de tamaño en bytes (default 15 MB)
 */
export async function uploadToGoogleDrive(
  fileStream: Readable,
  fileName: string,
  mimeType: string,
  maxBytes = 15 * 1024 * 1024,
): Promise<UploadResult> {
  const drive = await createDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  // Insertar SizeGuard en el pipeline para rechazar archivos demasiado grandes
  // antes de que terminen de subirse
  const guarded = fileStream.pipe(new SizeGuard(maxBytes));

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: folderId ? [folderId] : undefined,
    },
    media: {
      mimeType: mimeType || 'application/gpx+xml',
      body: guarded, // googleapis usa Resumable Upload automáticamente con streams
    },
    fields: 'id,name,webViewLink',
  });

  const file = response.data;
  if (!file.id) throw new Error('Google Drive no retornó un fileId');

  // Dar acceso de lectura a cualquiera con el enlace
  await drive.permissions.create({
    fileId: file.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return {
    fileId: file.id,
    fileName: file.name ?? fileName,
    webViewLink:
      file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
  };
}

// ─── Delete ─────────────────────────────────────────────────────────────────

/**
 * Borra un archivo de Google Drive por su fileId.
 * Reutiliza el mismo cliente OAuth2 (scope drive.file) que la subida: la app
 * puede borrar archivos que ella misma creó.
 */
export async function deleteFromGoogleDrive(fileId: string): Promise<void> {
  const drive = await createDriveClient();
  await drive.files.delete({ fileId });
}
