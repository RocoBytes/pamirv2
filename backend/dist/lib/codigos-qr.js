import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
// Módulo puro (sin Prisma, sin I/O) con las reglas de negocio del QR
// reusable del club: duraciones/topes permitidos, el ciclo de vida de un
// código y el cifrado reversible de su token. La orquestación (persistencia,
// envío de correo, transacción de "uso") vive en
// services/codigos-qr.service.ts.
export const QR_DURACIONES = {
    '2h': 2 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
};
export const QR_DURACION_DEFAULT = '24h';
export const QR_MAX_USOS_DEFAULT = 50;
export const QR_MAX_USOS_MIN = 1;
export const QR_MAX_USOS_TOPE = 200;
export const QR_ETIQUETA_MAX = 80;
// Precedencia: REVOCADO > EXPIRADO > AGOTADO > ACTIVO.
export function estadoCodigoQr(qr, now) {
    if (qr.revocadoAt)
        return 'REVOCADO';
    if (qr.expiresAt <= now)
        return 'EXPIRADO';
    if (qr.usosRestantes <= 0)
        return 'AGOTADO';
    return 'ACTIVO';
}
export const ROL_QR = 'SOCIO';
// ─── Cifrado reversible del token ──────────────────────────────────────────────
// A diferencia de una invitación por correo (solo se guarda el hash: el token
// en claro nunca vuelve a hacer falta después de enviarlo), un QR reusable se
// proyecta o imprime y su creador puede necesitar volver a mostrarlo mientras
// siga ACTIVO (ver verCodigoQr en el servicio) — de ahí un cifrado reversible
// además del hash de búsqueda. AES-256-GCM con una clave derivada por HKDF de
// JWT_SECRET (nunca la clave de JWT en crudo), IV aleatorio de 12 bytes por
// cifrado. Formato de payload: "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>".
const HKDF_SALT = 'riala-qr';
const HKDF_INFO = 'riala-qr-token-v1';
const HKDF_KEY_LEN = 32;
const GCM_IV_LEN = 12;
const PAYLOAD_VERSION = 'v1';
function deriveKey(secret) {
    const derived = hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, HKDF_KEY_LEN);
    return Buffer.from(derived);
}
export function cifrarTokenQr(token, secret) {
    const key = deriveKey(secret);
    const iv = randomBytes(GCM_IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
        PAYLOAD_VERSION,
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}
// Devuelve null ante CUALQUIER fallo (clave equivocada, payload alterado,
// formato inválido): el llamador (verCodigoQr) lo trata como "este QR se
// creó en otro entorno" — nunca lanza ni distingue el motivo exacto.
export function descifrarTokenQr(payload, secret) {
    try {
        const partes = payload.split('.');
        if (partes.length !== 4)
            return null;
        const [version, ivB64, tagB64, ciphertextB64] = partes;
        if (version !== PAYLOAD_VERSION)
            return null;
        const key = deriveKey(secret);
        const iv = Buffer.from(ivB64 ?? '', 'base64url');
        const tag = Buffer.from(tagB64 ?? '', 'base64url');
        const ciphertext = Buffer.from(ciphertextB64 ?? '', 'base64url');
        if (iv.length !== GCM_IV_LEN || tag.length === 0 || ciphertext.length === 0)
            return null;
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plaintext.toString('utf8');
    }
    catch {
        return null;
    }
}
