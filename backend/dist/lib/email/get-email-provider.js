import { createSmtpProvider } from './smtp.provider.js';
import { createConsoleProvider } from './console.provider.js';
// El error solo nombra las variables faltantes o inválidas, nunca sus
// valores, para que un log de arranque no filtre credenciales.
function assertSmtpEnv(params) {
    const missing = [];
    if (!params.smtpHost)
        missing.push('SMTP_HOST');
    if (!params.smtpUser)
        missing.push('SMTP_USER');
    if (!params.smtpPass)
        missing.push('SMTP_PASS');
    const port = params.smtpPort ? Number(params.smtpPort) : NaN;
    const portValido = Number.isInteger(port) && port >= 1 && port <= 65535;
    if (!portValido)
        missing.push('SMTP_PORT');
    if (missing.length > 0) {
        throw new Error(`Configuración SMTP incompleta o inválida: falta(n) ${missing.join(', ')}`);
    }
    return { host: params.smtpHost, port, user: params.smtpUser, pass: params.smtpPass };
}
// Pura (sin process.env, sin red): decide qué proveedor corresponde usar.
// EMAIL_PROVIDER explícito manda; si no está definido, se usa SMTP cuando hay
// SMTP_HOST y "console" en caso contrario. Si el proveedor resuelto es SMTP,
// exige el resto de las variables de conexión (ver assertSmtpEnv). "console"
// nunca es válido en producción: un servidor que solo registra en el log las
// alarmas de seguridad en vez de enviarlas es inaceptable.
export function selectEmailProvider(params) {
    const explicit = params.emailProvider?.trim().toLowerCase();
    if (explicit && explicit !== 'smtp' && explicit !== 'console') {
        throw new Error(`EMAIL_PROVIDER="${explicit}" no es un proveedor de correo reconocido`);
    }
    const resolved = explicit === 'smtp' ? 'smtp' : explicit === 'console' ? 'console' : params.smtpHost ? 'smtp' : 'console';
    if (resolved === 'smtp') {
        assertSmtpEnv(params);
    }
    if (resolved === 'console' && params.nodeEnv === 'production') {
        throw new Error('No se puede usar el proveedor de correo "console" en producción: un servidor que solo registra las ' +
            'alarmas de seguridad en el log en vez de enviarlas es inaceptable.');
    }
    return resolved;
}
let cachedProvider;
// Memoizado a propósito: una sola instancia por proceso basta (los
// adaptadores no guardan estado mutable propio) y evita releer el entorno en
// cada envío.
export function getEmailProvider() {
    if (cachedProvider)
        return cachedProvider;
    const params = {
        emailProvider: process.env.EMAIL_PROVIDER,
        smtpHost: process.env.SMTP_HOST,
        smtpPort: process.env.SMTP_PORT,
        smtpUser: process.env.SMTP_USER,
        smtpPass: process.env.SMTP_PASS,
        nodeEnv: process.env.NODE_ENV,
    };
    const name = selectEmailProvider(params);
    cachedProvider = name === 'smtp' ? createSmtpProvider(assertSmtpEnv(params)) : createConsoleProvider();
    return cachedProvider;
}
