import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Storage } from '@google-cloud/storage';
import { SizeGuard } from './size-guard.js';
import { assertSafeObjectPrefix } from './object-key.js';
import type { FileStorage, SignedDownloadOptions, StoredFileMetadata, UploadOptions } from './file-storage.js';

// Metadata cruda que devuelve el SDK — solo los campos que este adaptador
// necesita, nunca el objeto Metadata completo de GCS.
export interface GcsObjectMetadata {
  contentType?: string;
  size?: string | number;
  etag?: string;
}

// Superficie mínima que este adaptador usa del SDK de GCS — angosta a
// propósito para que los tests inyecten un cliente falso sin tocar la red ni
// depender de tipos internos del SDK. Mismo patrón que SmtpTransport en
// lib/email/smtp.provider.ts.
export interface GcsFileLike {
  createWriteStream(options: { resumable: boolean; contentType: string }): NodeJS.WritableStream;
  getSignedUrl(options: {
    version: 'v4';
    action: 'read';
    expires: number;
    responseDisposition: string;
  }): Promise<[string]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
  createReadStream(): NodeJS.ReadableStream;
  getMetadata(): Promise<[GcsObjectMetadata, ...unknown[]]>;
}

export interface GcsBucketLike {
  file(key: string): GcsFileLike;
  getFiles(options: { prefix: string }): Promise<[GcsFileLike[], ...unknown[]]>;
}

export interface GcsCredentials {
  client_email: string;
  private_key: string;
}

export interface CreateGcsStorageParams {
  bucket: string;
  projectId: string;
  credentials: GcsCredentials;
  // Inyectable para los tests (nunca abren una conexión real). Cuando no se
  // provee, se construye un cliente real de @google-cloud/storage.
  client?: { bucket(name: string): GcsBucketLike };
}

// El nombre de descarga viaja dentro de una cabecera HTTP
// (Content-Disposition): CRLF, comillas, backslash y separadores de ruta se
// eliminan para que nunca pueda inyectar otra cabecera ni cambiar la ruta que
// percibe el navegador.
function sanitizeDownloadName(raw: string): string {
  const cleaned = raw.replace(/[\r\n"\\/]/g, '').trim();
  return cleaned || 'archivo';
}

/**
 * Adaptador de almacenamiento sobre Google Cloud Storage. El archivo NUNCA se
 * carga completo en RAM ni toca disco (el contenedor es read_only): se
 * canaliza directo desde el stream de origen, a través de SizeGuard, hacia un
 * write stream resumable de GCS.
 */
export function createGcsStorage(params: CreateGcsStorageParams): FileStorage {
  const client =
    params.client ??
    (new Storage({ projectId: params.projectId, credentials: params.credentials }) as unknown as {
      bucket(name: string): GcsBucketLike;
    });
  const bucket = client.bucket(params.bucket);

  return {
    async upload(stream: Readable, options: UploadOptions): Promise<void> {
      const file = bucket.file(options.key);
      try {
        await pipeline(
          stream,
          new SizeGuard(options.maxBytes),
          file.createWriteStream({ resumable: true, contentType: options.contentType }),
        );
      } catch (err) {
        // Best-effort: nunca deja un objeto parcial huérfano en el bucket, y
        // nunca oculta el error original si la limpieza también falla.
        await file.delete({ ignoreNotFound: true }).catch(() => undefined);
        throw err;
      }
    },

    async createSignedDownloadUrl(key: string, options: SignedDownloadOptions): Promise<string> {
      const [url] = await bucket.file(key).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + options.expiresInSeconds * 1000,
        responseDisposition: `attachment; filename="${sanitizeDownloadName(options.downloadName)}"`,
      });
      return url;
    },

    async delete(key: string): Promise<void> {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },

    async deleteByPrefix(prefix: string): Promise<void> {
      assertSafeObjectPrefix(prefix);
      const [files] = await bucket.getFiles({ prefix });
      await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
    },

    async readMetadata(key: string): Promise<StoredFileMetadata | null> {
      try {
        const [metadata] = await bucket.file(key).getMetadata();
        return {
          contentType: metadata.contentType ?? 'application/octet-stream',
          size: Number(metadata.size ?? 0),
          etag: metadata.etag ?? '',
        };
      } catch (err) {
        // El SDK reporta "no encontrado" como error con code 404 — se traduce
        // a null en vez de propagar la excepción (ver StoredFileMetadata).
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },

    createReadStream(key: string): NodeJS.ReadableStream {
      return bucket.file(key).createReadStream();
    },
  };
}
