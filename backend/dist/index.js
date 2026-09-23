import 'dotenv/config';
// Se importa explícitamente (y antes que el resto) para que una dirección
// remitente inválida en MAIL_FROM, o un par de credenciales SMTP a medio
// configurar en MAIL_ACCOUNTS (ver lib/config.ts), detengan el arranque acá,
// en vez de esperar al primer envío de correo.
import { MAIL_ACCOUNTS, mailAccountEnvVarNames } from './lib/config.js';
import app from './app.js';
// Fail fast en producción: sin estas variables la app arranca pero envía
// links a localhost en los correos (auth/cierres), rechaza todo el cron o no
// puede enviar ningún correo transaccional.
if (process.env.NODE_ENV === 'production') {
    for (const key of [
        'DATABASE_URL',
        'FRONTEND_URL',
        'BACKEND_URL',
        'CRON_SECRET',
        'SMTP_HOST',
        'SMTP_PORT',
        'GCS_BUCKET',
        'GCS_PROJECT_ID',
        'GCS_CREDENTIALS_JSON',
    ]) {
        if (!process.env[key]) {
            throw new Error(`Missing required env var: ${key}`);
        }
    }
    // SMTP_USER/SMTP_PASS ya no son incondicionalmente obligatorias: alcanza
    // con que CADA tipo de correo resuelva una cuenta, ya sea por su propio par
    // (SMTP_USER_<TIPO>/SMTP_PASS_<TIPO>) o por el par global. Ver
    // resolveMailAccounts en lib/config.ts — el servidor SMTP real rechaza en
    // RCPT TO un envío autenticado con una cuenta que no es dueña de la
    // dirección remitente, así que un tipo sin cuenta resuelta nunca podría
    // enviar en producción.
    for (const kind of Object.keys(MAIL_ACCOUNTS)) {
        const account = MAIL_ACCOUNTS[kind];
        if (account.user && account.pass)
            continue;
        const { userEnvVar, passEnvVar } = mailAccountEnvVarNames(kind);
        throw new Error(`Missing required env var: ${userEnvVar} and ${passEnvVar}, or the global SMTP_USER and SMTP_PASS, ` +
            `for email kind "${kind}"`);
    }
}
const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
    console.log(`RIALA API running on port ${PORT}`);
});
