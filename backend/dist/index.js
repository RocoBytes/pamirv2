import 'dotenv/config';
// Se importa explícitamente (y antes que el resto) para que una dirección
// remitente inválida en MAIL_FROM (ver lib/config.ts) detenga el arranque
// acá, en vez de esperar al primer envío de correo.
import './lib/config.js';
import app from './app.js';
// Fail fast en producción: sin estas variables la app arranca pero envía
// links a localhost en los correos (auth/cierres), rechaza todo el cron o no
// puede enviar ningún correo transaccional.
if (process.env.NODE_ENV === 'production') {
    for (const key of ['DATABASE_URL', 'FRONTEND_URL', 'BACKEND_URL', 'CRON_SECRET', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) {
        if (!process.env[key]) {
            throw new Error(`Missing required env var: ${key}`);
        }
    }
}
const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
    console.log(`Pamir API running on port ${PORT}`);
});
