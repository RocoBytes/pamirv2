import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SizeGuard } from './size-guard.js';
import { assertSafeObjectPrefix } from './object-key.js';
import type { FileStorage, SignedDownloadOptions, UploadOptions } from './file-storage.js';

interface StoredObject {
  buffer: Buffer;
  contentType: string;
}

export interface MemoryFileStorage extends FileStorage {
  // Helpers de inspección solo para tests — nunca los usa código de producción.
  has(key: string): boolean;
  keys(): string[];
}

function sanitizeDownloadName(raw: string): string {
  const cleaned = raw.replace(/[\r\n"\\/]/g, '').trim();
  return cleaned || 'archivo';
}

/**
 * Adaptador en memoria para tests: nunca toca disco ni red. Aplica el mismo
 * SizeGuard que el adaptador real de GCS, para que un test de límite de
 * tamaño no dependa de tener un bucket real.
 */
export function createMemoryStorage(): MemoryFileStorage {
  const objects = new Map<string, StoredObject>();

  return {
    async upload(stream: Readable, options: UploadOptions): Promise<void> {
      const chunks: Buffer[] = [];
      await pipeline(
        stream,
        new SizeGuard(options.maxBytes),
        new Writable({
          write(chunk: Buffer, _enc, cb) {
            chunks.push(chunk);
            cb();
          },
        }),
      );
      objects.set(options.key, { buffer: Buffer.concat(chunks), contentType: options.contentType });
    },

    async createSignedDownloadUrl(key: string, options: SignedDownloadOptions): Promise<string> {
      const expires = Date.now() + options.expiresInSeconds * 1000;
      const name = encodeURIComponent(sanitizeDownloadName(options.downloadName));
      return `memory://${key}?expires=${expires}&name=${name}`;
    },

    async delete(key: string): Promise<void> {
      objects.delete(key);
    },

    async deleteByPrefix(prefix: string): Promise<void> {
      assertSafeObjectPrefix(prefix);
      for (const key of objects.keys()) {
        if (key.startsWith(prefix)) objects.delete(key);
      }
    },

    has(key: string): boolean {
      return objects.has(key);
    },

    keys(): string[] {
      return [...objects.keys()];
    },
  };
}
