import { pipeline } from 'node:stream/promises';
import { Storage } from '@google-cloud/storage';
import { SizeGuard } from './size-guard.js';
import { assertSafeObjectPrefix } from './object-key.js';
// El nombre de descarga viaja dentro de una cabecera HTTP
// (Content-Disposition): CRLF, comillas, backslash y separadores de ruta se
// eliminan para que nunca pueda inyectar otra cabecera ni cambiar la ruta que
// percibe el navegador.
function sanitizeDownloadName(raw) {
    const cleaned = raw.replace(/[\r\n"\\/]/g, '').trim();
    return cleaned || 'archivo';
}
/**
 * Adaptador de almacenamiento sobre Google Cloud Storage. El archivo NUNCA se
 * carga completo en RAM ni toca disco (el contenedor es read_only): se
 * canaliza directo desde el stream de origen, a través de SizeGuard, hacia un
 * write stream resumable de GCS.
 */
export function createGcsStorage(params) {
    const client = params.client ??
        new Storage({ projectId: params.projectId, credentials: params.credentials });
    const bucket = client.bucket(params.bucket);
    return {
        async upload(stream, options) {
            const file = bucket.file(options.key);
            try {
                await pipeline(stream, new SizeGuard(options.maxBytes), file.createWriteStream({ resumable: true, contentType: options.contentType }));
            }
            catch (err) {
                // Best-effort: nunca deja un objeto parcial huérfano en el bucket, y
                // nunca oculta el error original si la limpieza también falla.
                await file.delete({ ignoreNotFound: true }).catch(() => undefined);
                throw err;
            }
        },
        async createSignedDownloadUrl(key, options) {
            const [url] = await bucket.file(key).getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + options.expiresInSeconds * 1000,
                responseDisposition: `attachment; filename="${sanitizeDownloadName(options.downloadName)}"`,
            });
            return url;
        },
        async delete(key) {
            await bucket.file(key).delete({ ignoreNotFound: true });
        },
        async deleteByPrefix(prefix) {
            assertSafeObjectPrefix(prefix);
            const [files] = await bucket.getFiles({ prefix });
            await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
        },
        async readMetadata(key) {
            try {
                const [metadata] = await bucket.file(key).getMetadata();
                return {
                    contentType: metadata.contentType ?? 'application/octet-stream',
                    size: Number(metadata.size ?? 0),
                    etag: metadata.etag ?? '',
                };
            }
            catch (err) {
                // El SDK reporta "no encontrado" como error con code 404 — se traduce
                // a null en vez de propagar la excepción (ver StoredFileMetadata).
                if (err.code === 404)
                    return null;
                throw err;
            }
        },
        createReadStream(key) {
            return bucket.file(key).createReadStream();
        },
    };
}
