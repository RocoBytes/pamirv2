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

export interface FileStorage {
  upload(stream: Readable, options: UploadOptions): Promise<void>;
  createSignedDownloadUrl(key: string, options: SignedDownloadOptions): Promise<string>;
  // Idempotente: que el objeto no exista no es un error.
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}
