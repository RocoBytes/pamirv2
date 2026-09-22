import nodemailer from 'nodemailer';
// Pura: solo arma las opciones de transporte, nunca abre una conexión. Se
// exporta y prueba por separado para no depender de un socket real.
// - Puerto 465: TLS implícito desde el primer byte (`secure: true`).
// - Cualquier otro puerto (587 típicamente): sin TLS implícito, pero exige
//   STARTTLS (`requireTLS: true`) para que las credenciales nunca viajen en
//   texto plano si el servidor no ofrece el upgrade.
// Los timeouts evitan que un servidor colgado bloquee indefinidamente al
// cron (que corre en el único proceso backend permitido).
export function buildSmtpTransportOptions(params) {
    const secure = params.port === 465;
    return {
        host: params.host,
        port: params.port,
        secure,
        ...(secure ? {} : { requireTLS: true }),
        auth: { user: params.user, pass: params.pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
    };
}
// Solo códigos cortos en mayúsculas (p. ej. EAUTH, ECONNECTION, ETIMEDOUT,
// EENVELOPE) — nunca un texto libre que pueda arrastrar datos sensibles.
const SAFE_ERROR_CODE = /^[A-Z_]+$/;
// nodemailer puede adjuntar la respuesta cruda del servidor SMTP en
// err.message/err.response, y esa respuesta puede citar el destinatario o
// incluso ecoar credenciales según el servidor. Por eso el error saneado
// NUNCA reutiliza err.message ni err.response, y nunca los adjunta como
// `cause`: se arma desde cero solo con err.code (si es un código corto y
// seguro) y err.responseCode (si es numérico).
function sanitizeSmtpError(err) {
    const rawCode = err?.code;
    const code = typeof rawCode === 'string' && SAFE_ERROR_CODE.test(rawCode) ? rawCode : undefined;
    const rawResponseCode = err?.responseCode;
    const responseCode = typeof rawResponseCode === 'number' ? rawResponseCode : undefined;
    const detalle = [code, responseCode].filter((v) => v !== undefined).join(', ');
    return new Error(`El servidor SMTP rechazó el envío${detalle ? ` (${detalle})` : ''}`);
}
// Adaptador SMTP: envía por el servidor de correo propio (nunca un proveedor
// externo). Nota sobre idempotencia: SMTP no la garantiza. `idempotencyKey`
// solo viaja como cabecera `X-Entity-Ref-ID` para trazabilidad manual — no
// evita un envío duplicado. Esto es aceptable porque cada llamador marca su
// propio estado (columna `enviadaAt`, `alertaEnviadaAt`, etc.) recién
// DESPUÉS de que este proveedor acepta el envío: un reintento puede DUPLICAR
// una alarma, pero nunca puede PERDERLA.
export function createSmtpProvider(params) {
    const transport = params.transport ??
        nodemailer.createTransport(buildSmtpTransportOptions({ host: params.host, port: params.port, user: params.user, pass: params.pass }));
    return {
        async send(message) {
            const idempotencyKey = message.idempotencyKey?.replace(/[\r\n]/g, '');
            try {
                const info = await transport.sendMail({
                    from: message.from,
                    to: message.to,
                    replyTo: message.replyTo,
                    subject: message.subject,
                    html: message.html,
                    ...(idempotencyKey ? { headers: { 'X-Entity-Ref-ID': idempotencyKey } } : {}),
                });
                return { id: info.messageId };
            }
            catch (err) {
                throw sanitizeSmtpError(err);
            }
        },
    };
}
