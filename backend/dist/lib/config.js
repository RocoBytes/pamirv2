import { emailField } from './auth-fields.js';
// Fuente única de configuración compartida por varios módulos (antes cada
// archivo declaraba su propio `FRONTEND_URL` con el mismo valor por defecto).
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
// Pura (nunca lee process.env directamente, recibe el entorno como parámetro
// para poder probarla sin mutar variables globales): resuelve FRONTEND_URL,
// usada en los links de los correos (verificación, restablecimiento de
// contraseña, invitaciones, evaluaciones, eventos, etc.) y por el CLI de
// clubes (scripts/tenant.ts). Un valor ausente, vacío o en blanco cae al
// valor por defecto — `??` por sí solo NO cubre el caso "definida pero en
// blanco" (`''` no es `undefined`), que es justamente lo que dejaba salir
// links sin host (`/#invite=...`) cuando la variable existía vacía en el
// entorno. Uno presente pero inválido detiene el arranque (ver FRONTEND_URL
// más abajo) en vez de construir esos links rotos en cada correo.
export function resolveFrontendUrl(env) {
    const raw = env['FRONTEND_URL']?.trim();
    const candidate = raw ? raw : DEFAULT_FRONTEND_URL;
    let parsed;
    try {
        parsed = new URL(candidate);
    }
    catch {
        throw new Error('FRONTEND_URL no es una URL absoluta http(s) válida');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('FRONTEND_URL no es una URL absoluta http(s) válida');
    }
    // Sin barra(s) final(es): evita que `${FRONTEND_URL}/#invite=...` (o
    // `${FRONTEND_URL}?...`) produzca `//` cuando la URL configurada ya termina
    // en "/". Se recorta sobre el string original (no sobre `parsed.toString()`,
    // que reintroduce una barra final para una URL sin ruta) para conservar tal
    // cual cualquier prefijo de ruta configurado (p. ej. "/app").
    return candidate.replace(/\/+$/, '');
}
// Evaluado al importar el módulo: un valor inválido detiene el arranque del
// proceso en vez de fallar silenciosamente en el primer correo o el primer
// link de invitación.
export const FRONTEND_URL = resolveFrontendUrl(process.env);
// Remitentes fijos de correo transaccional, uno por TIPO de correo — nunca
// por club ni por actividad (la identidad del club va en el nombre visible,
// ver lib/email/club-email.ts). Agregar un tipo nuevo en el futuro (p. ej.
// "invitacion") es agregar UNA entrada acá: ningún llamador ni club-email.ts
// cambian.
const MAIL_SENDER_DEFS = {
    notificacion: { envVar: 'MAIL_FROM_NOTIFICACIONES', fallback: 'notificaciones@riala.cl' },
    alerta: { envVar: 'MAIL_FROM_ALERTAS', fallback: 'alertas@riala.cl' },
};
// Pura (nunca lee process.env directamente, recibe el entorno como parámetro
// para poder probarla sin mutar variables globales): resuelve cada tipo de
// correo a su dirección remitente. Un valor vacío o en blanco cae al valor
// por defecto; uno presente pero inválido detiene el arranque (ver MAIL_FROM
// más abajo) en vez de dejar un correo salir desde una dirección rota.
export function resolveMailFrom(env) {
    const result = {};
    for (const kind of Object.keys(MAIL_SENDER_DEFS)) {
        const def = MAIL_SENDER_DEFS[kind];
        const raw = env[def.envVar]?.trim();
        const candidate = raw ? raw : def.fallback;
        const parsed = emailField.safeParse(candidate);
        if (!parsed.success) {
            throw new Error(`${def.envVar} no es una dirección de correo válida`);
        }
        result[kind] = parsed.data;
    }
    return result;
}
// Evaluado al importar el módulo: una dirección remitente inválida detiene el
// arranque del proceso en vez de fallar silenciosamente en el primer envío.
export const MAIL_FROM = resolveMailFrom(process.env);
