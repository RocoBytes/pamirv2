import type { Readable } from 'node:stream';

// Puerto de almacenamiento de archivos: cada adaptador (GCS, memoria) lo
// implementa sin filtrar detalles propios (SDK, credenciales, etc.) al resto
// del código — mismo patrón que lib/email/email-provider.ts.
export interface UploadOptions {
  key: string;
  contentType: string;
  maxBytes: number;
}

export interface SignedDownloadOptions {
  expiresInSeconds: number;
  downloadName: string;
}

export interface StoredFileMetadata {
  contentType: string;
  size: number;
  etag: string;
}

export interface FileStorage {
  upload(stream: Readable, options: UploadOptions): Promise<void>;
  createSignedDownloadUrl(key: string, options: SignedDownloadOptions): Promise<string>;
  // Idempotente: que el objeto no exista no es un error.
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
  // null si el objeto no existe — "no encontrado" nunca es una excepción.
  // Usado por el logo del club (único archivo que se lee por bytes en vez de
  // firmar una URL de descarga — ver GET /api/clubes/:slug/logo).
  readMetadata(key: string): Promise<StoredFileMetadata | null>;
  createReadStream(key: string): NodeJS.ReadableStream;
}
