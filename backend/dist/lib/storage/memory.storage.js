import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SizeGuard } from './size-guard.js';
import { assertSafeObjectPrefix } from './object-key.js';
function sanitizeDownloadName(raw) {
    const cleaned = raw.replace(/[\r\n"\\/]/g, '').trim();
    return cleaned || 'archivo';
}
/**
 * Adaptador en memoria para tests: nunca toca disco ni red. Aplica el mismo
 * SizeGuard que el adaptador real de GCS, para que un test de límite de
 * tamaño no dependa de tener un bucket real.
 */
export function createMemoryStorage() {
    const objects = new Map();
    return {
        async upload(stream, options) {
            const chunks = [];
            await pipeline(stream, new SizeGuard(options.maxBytes), new Writable({
                write(chunk, _enc, cb) {
                    chunks.push(chunk);
                    cb();
                },
            }));
            objects.set(options.key, { buffer: Buffer.concat(chunks), contentType: options.contentType });
        },
        async createSignedDownloadUrl(key, options) {
            const expires = Date.now() + options.expiresInSeconds * 1000;
            const name = encodeURIComponent(sanitizeDownloadName(options.downloadName));
            return `memory://${key}?expires=${expires}&name=${name}`;
        },
        async delete(key) {
            objects.delete(key);
        },
        async deleteByPrefix(prefix) {
            assertSafeObjectPrefix(prefix);
            for (const key of objects.keys()) {
                if (key.startsWith(prefix))
                    objects.delete(key);
            }
        },
        has(key) {
            return objects.has(key);
        },
        keys() {
            return [...objects.keys()];
        },
    };
}
