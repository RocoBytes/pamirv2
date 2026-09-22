// Ejercita el bucket REAL de GCS de principio a fin (subida, URL firmada,
// límite de tamaño, borrado, deleteByPrefix). No se ejecuta como parte de
// `npm test` (usa `npm run test:storage`): abre conexiones reales contra
// Google Cloud Storage. Nunca corre contra el adaptador de memoria — un
// bucket real es justo lo que este script necesita probar. Limpia todo lo que
// crea, incluso si algún check falla.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { getFileStorage, selectStorageProvider } from '../lib/storage/get-file-storage.js';
import { buildObjectKey, organizationPrefix } from '../lib/storage/object-key.js';
const results = [];
async function check(label, fn) {
    try {
        await fn();
        results.push({ label, ok: true });
    }
    catch (err) {
        results.push({ label, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
}
function printReport() {
    console.log('\n[test-storage] Reporte:');
    for (const r of results) {
        const mark = r.ok ? '✓' : '✗';
        console.log(`  ${mark} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    const fails = results.filter((r) => !r.ok).length;
    console.log(`\n[test-storage] ${results.length - fails}/${results.length} verificaciones pasaron.`);
}
// Prefijo sintético propio de esta corrida — deleteByPrefix nunca toca nada
// fuera de él, así que este script jamás puede pisar datos reales del bucket.
const TEST_ORG_ID = `test-storage-${randomUUID()}`;
async function expectStatus(storage, key, expected) {
    const url = await storage.createSignedDownloadUrl(key, { expiresInSeconds: 60, downloadName: 'check' });
    const res = await fetch(url);
    if (res.status !== expected) {
        throw new Error(`se esperaba HTTP ${expected} para "${key}", se obtuvo ${res.status}`);
    }
}
async function main() {
    const resolved = selectStorageProvider({
        storageProvider: process.env.STORAGE_PROVIDER,
        gcsBucket: process.env.GCS_BUCKET,
        gcsProjectId: process.env.GCS_PROJECT_ID,
        gcsCredentialsJson: process.env.GCS_CREDENTIALS_JSON,
        nodeEnv: process.env.NODE_ENV,
    });
    if (resolved !== 'gcs') {
        console.error('[test-storage] Este script ejercita el bucket real de GCS: exige STORAGE_PROVIDER=gcs (o las variables ' +
            'GCS_BUCKET/GCS_PROJECT_ID/GCS_CREDENTIALS_JSON que lo infieren). Nunca corre contra "memory".');
        process.exitCode = 1;
        return;
    }
    const storage = getFileStorage();
    const content = Buffer.from(`test-storage ${new Date().toISOString()}`);
    const key = buildObjectKey({ organizationId: TEST_ORG_ID, kind: 'gpx', extension: 'gpx' });
    const oversizeKey = buildObjectKey({ organizationId: TEST_ORG_ID, kind: 'gpx', extension: 'gpx' });
    const prefixKeyA = buildObjectKey({ organizationId: TEST_ORG_ID, kind: 'documento', extension: 'pdf' });
    const prefixKeyB = buildObjectKey({ organizationId: TEST_ORG_ID, kind: 'documento', extension: 'pdf' });
    try {
        await check('upload sube el contenido sin error', async () => {
            await storage.upload(Readable.from([content]), {
                key,
                contentType: 'application/gpx+xml',
                maxBytes: 1024,
            });
        });
        await check('la URL firmada descarga exactamente el mismo contenido', async () => {
            const url = await storage.createSignedDownloadUrl(key, { expiresInSeconds: 60, downloadName: 'test.gpx' });
            const res = await fetch(url);
            if (!res.ok)
                throw new Error(`la descarga respondió ${res.status}`);
            const downloaded = Buffer.from(await res.arrayBuffer());
            if (!downloaded.equals(content))
                throw new Error('el contenido descargado no coincide con el subido');
        });
        // Lectura directa (la usa GET /api/clubes/:slug/logo, que sirve los bytes
        // en vez de firmar una URL). Contra el SDK real, no contra un fake: lo que
        // los tests unitarios no pueden probar es la forma de getMetadata y la
        // traducción del error 404 del SDK a null.
        await check('readMetadata devuelve el contentType, el tamaño y un etag reales', async () => {
            const metadata = await storage.readMetadata(key);
            if (!metadata)
                throw new Error('readMetadata devolvió null para un objeto existente');
            if (metadata.contentType !== 'application/gpx+xml') {
                throw new Error(`contentType inesperado: ${metadata.contentType}`);
            }
            if (metadata.size !== content.byteLength) {
                throw new Error(`tamaño inesperado: ${metadata.size} (esperado ${content.byteLength})`);
            }
            if (!metadata.etag)
                throw new Error('el etag vino vacío');
        });
        await check('createReadStream devuelve exactamente los mismos bytes', async () => {
            const chunks = [];
            for await (const chunk of storage.createReadStream(key)) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            if (!Buffer.concat(chunks).equals(content)) {
                throw new Error('el contenido leído no coincide con el subido');
            }
        });
        await check('readMetadata de una clave inexistente devuelve null, no lanza', async () => {
            const ausente = buildObjectKey({ organizationId: TEST_ORG_ID, kind: 'logo', extension: 'png' });
            const metadata = await storage.readMetadata(ausente);
            if (metadata !== null)
                throw new Error('se esperaba null para un objeto que no existe');
        });
        await check('un upload que excede maxBytes se rechaza con FILE_TOO_LARGE', async () => {
            let threw = false;
            try {
                await storage.upload(Readable.from([Buffer.alloc(10, 'a')]), {
                    key: oversizeKey,
                    contentType: 'application/gpx+xml',
                    maxBytes: 4,
                });
            }
            catch (err) {
                threw = true;
                const code = err.code;
                if (code !== 'FILE_TOO_LARGE')
                    throw new Error(`código de error inesperado: ${code}`);
            }
            if (!threw)
                throw new Error('se esperaba que el upload lanzara');
        });
        await check('el upload rechazado no deja un objeto huérfano', () => expectStatus(storage, oversizeKey, 404));
        await check('delete borra el objeto', async () => {
            await storage.delete(key);
        });
        await check('tras delete, la URL firmada responde 404', () => expectStatus(storage, key, 404));
        await check('delete es idempotente (borrar de nuevo no lanza)', async () => {
            await storage.delete(key);
        });
        await check('deleteByPrefix borra solo su propio prefijo sintético', async () => {
            await storage.upload(Readable.from([content]), {
                key: prefixKeyA,
                contentType: 'application/pdf',
                maxBytes: 1024,
            });
            await storage.upload(Readable.from([content]), {
                key: prefixKeyB,
                contentType: 'application/pdf',
                maxBytes: 1024,
            });
            await storage.deleteByPrefix(organizationPrefix(TEST_ORG_ID));
            await expectStatus(storage, prefixKeyA, 404);
            await expectStatus(storage, prefixKeyB, 404);
        });
    }
    finally {
        // Limpieza best-effort: nunca debe dejar objetos de prueba en el bucket
        // real, incluso si algún check de arriba falló a mitad de camino.
        await storage
            .deleteByPrefix(organizationPrefix(TEST_ORG_ID))
            .catch((err) => console.error('[test-storage] No se pudo limpiar el prefijo de prueba:', err));
    }
    printReport();
    process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
}
main().catch((err) => {
    console.error('[test-storage] Error fatal:', err);
    process.exitCode = 1;
});
