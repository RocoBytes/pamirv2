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
// ver lib/email/club-email.ts). `userEnvVar`/`passEnvVar` son las variables
// OPCIONALES de credenciales propias de cada tipo (ver resolveMailAccounts
// más abajo) — existen porque el servidor SMTP real impone "sender
// ownership": rechaza en RCPT TO cualquier envío cuya dirección remitente no
// sea dueña la cuenta autenticada, con un 553 del estilo
// "Sender address rejected: not owned by user ...". Agregar un tipo nuevo en
// el futuro (p. ej. "invitacion") es agregar UNA entrada acá con su propio
// par de variables: ningún llamador ni club-email.ts cambian.
const MAIL_SENDER_DEFS = {
    notificacion: {
        envVar: 'MAIL_FROM_NOTIFICACIONES',
        fallback: 'notificaciones@riala.cl',
        userEnvVar: 'SMTP_USER_NOTIFICACIONES',
        passEnvVar: 'SMTP_PASS_NOTIFICACIONES',
    },
    alerta: {
        envVar: 'MAIL_FROM_ALERTAS',
        fallback: 'alertas@riala.cl',
        userEnvVar: 'SMTP_USER_ALERTAS',
        passEnvVar: 'SMTP_PASS_ALERTAS',
    },
};
// Nombres de las variables de credenciales propias de un tipo de correo (sin
// leer su valor) — usado por el fail-fast de producción (src/index.ts) para
// nombrar exactamente qué variables faltan cuando ni el par propio del tipo
// ni el global (SMTP_USER/SMTP_PASS) alcanzan.
export function mailAccountEnvVarNames(kind) {
    const def = MAIL_SENDER_DEFS[kind];
    return { userEnvVar: def.userEnvVar, passEnvVar: def.passEnvVar };
}
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
// Pura (nunca lee process.env directamente): resuelve, para cada tipo de
// correo, la cuenta SMTP que debe autenticarse al enviarlo. Cuando el par
// propio del tipo (SMTP_USER_<TIPO>/SMTP_PASS_<TIPO>) está completo, se usa
// ese; si no, cae junto al par global (SMTP_USER/SMTP_PASS) — nunca mezcla un
// usuario de un par con la clave del otro. En blanco o solo espacios cuenta
// como ausente, igual que en resolveMailFrom/resolveFrontendUrl (`??` por sí
// solo no cubre "definida pero en blanco"). Definir solo una mitad del par
// propio de un tipo (usuario sin clave o viceversa) queda a medio configurar
// y caería en silencio al par equivocado — un servidor con "sender
// ownership" lo rechazaría recién en el primer envío real, así que se detiene
// el arranque nombrando ambas variables en vez de eso.
export function resolveMailAccounts(env) {
    const addresses = resolveMailFrom(env);
    const globalUser = env['SMTP_USER']?.trim();
    const globalPass = env['SMTP_PASS']?.trim();
    const result = {};
    for (const kind of Object.keys(MAIL_SENDER_DEFS)) {
        const def = MAIL_SENDER_DEFS[kind];
        const ownUser = env[def.userEnvVar]?.trim();
        const ownPass = env[def.passEnvVar]?.trim();
        if (ownUser && !ownPass) {
            throw new Error(`${def.passEnvVar} falta: ${def.userEnvVar} está definida pero no su contraseña`);
        }
        if (ownPass && !ownUser) {
            throw new Error(`${def.userEnvVar} falta: ${def.passEnvVar} está definida pero no su usuario`);
        }
        result[kind] = {
            address: addresses[kind],
            user: ownUser || globalUser || '',
            pass: ownPass || globalPass || '',
        };
    }
    return result;
}
// Evaluado al importar el módulo: un par de credenciales a medio configurar
// detiene el arranque del proceso en vez de fallar silenciosamente en el
// primer envío (ver resolveMailAccounts).
export const MAIL_ACCOUNTS = resolveMailAccounts(process.env);
