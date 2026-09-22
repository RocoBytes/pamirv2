import { createGcsStorage } from './gcs.storage.js';
import { createMemoryStorage } from './memory.storage.js';
// El error solo nombra las variables faltantes, nunca sus valores — mismo
// criterio que assertSmtpEnv en lib/email/get-email-provider.ts.
function assertGcsEnv(params) {
    const missing = [];
    if (!params.gcsBucket)
        missing.push('GCS_BUCKET');
    if (!params.gcsProjectId)
        missing.push('GCS_PROJECT_ID');
    if (!params.gcsCredentialsJson)
        missing.push('GCS_CREDENTIALS_JSON');
    if (missing.length > 0) {
        throw new Error(`Configuración de almacenamiento GCS incompleta: falta(n) ${missing.join(', ')}`);
    }
}
// Pura (sin process.env, sin red): decide qué proveedor de almacenamiento
// corresponde usar. STORAGE_PROVIDER explícito manda; si no está definido, se
// usa "gcs" cuando hay GCS_BUCKET y "memory" en caso contrario. "memory"
// nunca es válido en producción: los archivos desaparecerían en cada reinicio
// del contenedor (el filesystem es efímero y read_only).
export function selectStorageProvider(params) {
    const explicit = params.storageProvider?.trim().toLowerCase();
    if (explicit && explicit !== 'gcs' && explicit !== 'memory') {
        throw new Error(`STORAGE_PROVIDER="${explicit}" no es un proveedor de almacenamiento reconocido`);
    }
    const resolved = explicit === 'gcs' ? 'gcs' : explicit === 'memory' ? 'memory' : params.gcsBucket ? 'gcs' : 'memory';
    if (resolved === 'gcs') {
        assertGcsEnv(params);
    }
    if (resolved === 'memory' && params.nodeEnv === 'production') {
        throw new Error('No se puede usar el proveedor de almacenamiento "memory" en producción: los archivos desaparecerían en ' +
            'cada reinicio del contenedor.');
    }
    return resolved;
}
// Pura: decodifica y valida la llave de la cuenta de servicio (base64 → JSON),
// sin tocar process.env ni la red. Sus errores nunca ecoan el contenido
// recibido, para que un log de arranque no filtre la llave privada.
export function parseGcsCredentials(base64) {
    const json = Buffer.from(base64, 'base64').toString('utf8');
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new Error('GCS_CREDENTIALS_JSON no contiene un JSON válido en base64');
    }
    const candidate = parsed;
    const clientEmail = candidate && typeof candidate === 'object' ? candidate.client_email : undefined;
    const privateKey = candidate && typeof candidate === 'object' ? candidate.private_key : undefined;
    if (typeof clientEmail !== 'string' || !clientEmail || typeof privateKey !== 'string' || !privateKey) {
        throw new Error('GCS_CREDENTIALS_JSON no contiene client_email/private_key válidos');
    }
    return { client_email: clientEmail, private_key: privateKey };
}
let cachedStorage;
// Memoizado a propósito: ver getEmailProvider en lib/email/get-email-provider.ts.
export function getFileStorage() {
    if (cachedStorage)
        return cachedStorage;
    const params = {
        storageProvider: process.env.STORAGE_PROVIDER,
        gcsBucket: process.env.GCS_BUCKET,
        gcsProjectId: process.env.GCS_PROJECT_ID,
        gcsCredentialsJson: process.env.GCS_CREDENTIALS_JSON,
        nodeEnv: process.env.NODE_ENV,
    };
    const name = selectStorageProvider(params);
    cachedStorage =
        name === 'gcs'
            ? createGcsStorage({
                bucket: params.gcsBucket,
                projectId: params.gcsProjectId,
                credentials: parseGcsCredentials(params.gcsCredentialsJson),
            })
            : createMemoryStorage();
    return cachedStorage;
}
