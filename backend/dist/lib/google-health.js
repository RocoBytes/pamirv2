let ok = true;
let failingSince = null;
let lastFailureAt = null;
let lastReason = null;
let lastSuccessAt = null;
let lastLoggedAt = null;
// La sonda corre cada 10 min: sin esto un token caído imprimiría la misma línea
// 144 veces al día.
const LOG_THROTTLE_MS = 60 * 60 * 1000;
export function recordGoogleAuthSuccess() {
    lastSuccessAt = new Date();
    ok = true;
    failingSince = null;
    lastReason = null;
    lastLoggedAt = null;
}
/**
 * Sólo un fallo de autenticación baja la bandera. Un 500 puntual de Gmail o un
 * 404 de Drive se registran, pero no encienden una alarma que el admin no puede
 * accionar.
 *
 * Devuelve true cuando la sonda periódica debería escribir en el log: en la
 * transición a caído y, como mucho, una vez por hora mientras siga caído.
 */
export function recordGoogleAuthFailure(err) {
    lastFailureAt = new Date();
    if (!err.isAuthFailure)
        return false;
    const esTransicion = ok;
    if (esTransicion)
        failingSince = lastFailureAt;
    ok = false;
    lastReason = err.message;
    const vencido = lastLoggedAt === null || lastFailureAt.getTime() - lastLoggedAt.getTime() >= LOG_THROTTLE_MS;
    if (!esTransicion && !vencido)
        return false;
    lastLoggedAt = lastFailureAt;
    return true;
}
export function getGoogleAuthHealth() {
    return {
        ok,
        failingSince: failingSince?.toISOString() ?? null,
        lastFailureAt: lastFailureAt?.toISOString() ?? null,
        lastReason,
        lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    };
}
