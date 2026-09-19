/**
 * Saneamiento de errores de las APIs de Google.
 *
 * gaxios redacta `client_secret` y `grant_type`, pero NO `refresh_token`: el
 * token viaja en texto plano dentro de `config.data` y `config.body`, así que
 * cualquier `console.error(..., err)` que reciba el error crudo lo escribe al
 * log del contenedor. Ocurrió: el token caducado quedó impreso 174 veces.
 *
 * `GoogleApiError` conserva sólo lo necesario para diagnosticar (status, motivo
 * y descripción) y descarta `config`/`response`, de modo que los ~18
 * `console.error` que ya existen impriman una línea limpia sin tocarlos.
 */
/** Forma de un refresh token de Google; se redacta por si aparece en un mensaje. */
const REFRESH_TOKEN_SHAPE = /1\/\/[\w-]+/g;
function scrub(text) {
    return text.replace(REFRESH_TOKEN_SHAPE, '<redacted>');
}
export class GoogleApiError extends Error {
    status;
    reason;
    constructor(message, status, reason) {
        super(message);
        this.name = 'GoogleApiError';
        this.status = status;
        this.reason = reason;
    }
    /** El refresh token está caducado, revocado o no autoriza la operación. */
    get isAuthFailure() {
        return (this.reason === 'invalid_grant' ||
            this.reason === 'invalid_client' ||
            this.reason === 'UNAUTHENTICATED' ||
            this.status === 401);
    }
}
/**
 * El abort del SizeGuard. Los controladores lo detectan por `code` para
 * responder 413, y gaxios puede envolverlo, así que también se mira `cause`.
 */
export function isFileTooLarge(err) {
    if (typeof err !== 'object' || err === null)
        return false;
    const e = err;
    return e.code === 'FILE_TOO_LARGE' || e.cause?.code === 'FILE_TOO_LARGE';
}
/**
 * Distingue un error de Google de uno propio (p. ej. el `FILE_TOO_LARGE` del
 * SizeGuard, cuyo `code` es un string y que los controladores inspeccionan).
 */
export function isGoogleApiFailure(err) {
    if (err instanceof GoogleApiError)
        return true;
    if (typeof err !== 'object' || err === null)
        return false;
    if (isFileTooLarge(err))
        return false;
    const e = err;
    return (e.response !== undefined ||
        typeof e.status === 'number' ||
        typeof e.code === 'number');
}
function readPayload(data) {
    if (typeof data !== 'object' || data === null)
        return {};
    const { error, error_description: description } = data;
    // Respuesta de oauth2.googleapis.com/token: { error, error_description }
    if (typeof error === 'string') {
        return {
            reason: error,
            detail: typeof description === 'string' ? description : undefined,
        };
    }
    // Respuesta de las APIs de Gmail/Drive: { error: { status, message } }
    if (typeof error === 'object' && error !== null) {
        const inner = error;
        return {
            reason: typeof inner.status === 'string' ? inner.status : undefined,
            detail: typeof inner.message === 'string' ? inner.message : undefined,
        };
    }
    return {};
}
/** Convierte un error de gaxios en uno sin credenciales dentro. */
export function toGoogleApiError(err) {
    if (err instanceof GoogleApiError)
        return err;
    const e = (typeof err === 'object' && err !== null ? err : {});
    const status = typeof e.status === 'number'
        ? e.status
        : typeof e.response?.status === 'number'
            ? e.response.status
            : typeof e.code === 'number'
                ? e.code
                : undefined;
    const { reason, detail } = readPayload(e.response?.data);
    const fallback = typeof e.message === 'string' ? e.message : 'error desconocido';
    const label = status !== undefined ? `Google API ${status}` : 'Google API';
    const summary = reason ?? fallback;
    const message = detail ? `${label}: ${summary} — ${detail}` : `${label}: ${summary}`;
    return new GoogleApiError(scrub(message), status, reason);
}
