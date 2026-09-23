import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import apiRouter from './routes/index.js';
import { loginKey, qrTokenKey, inviteTokenKey, verifiedUserOrIpKey, isAuthSubpathWithOwnLimit, isOwnRateLimitFamily, isQrEstadoPath, } from './lib/rate-limits.js';
const app = express();
// Confiar en el proxy de Render (necesario para express-rate-limit en producción)
app.set('trust proxy', 1);
// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());
// ─── CORS — fail-secure ───────────────────────────────────────────────────────
// Si FRONTEND_URL no está configurada sólo permite localhost (nunca origen abierto).
// Para deploys de preview de Vercel, añade sus URLs en ADDITIONAL_ORIGINS (separadas por coma).
const FRONTEND_URL = process.env.FRONTEND_URL;
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'];
const ADDITIONAL_ORIGINS = process.env.ADDITIONAL_ORIGINS
    ? process.env.ADDITIONAL_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
app.use(cors({
    origin: (origin, callback) => {
        const allowed = !origin ||
            (FRONTEND_URL
                ? origin === FRONTEND_URL || ADDITIONAL_ORIGINS.includes(origin)
                : DEV_ORIGINS.includes(origin));
        callback(null, allowed ? origin : false);
    },
    credentials: true,
}));
// express.json() corre ANTES de cualquier limitador de tasa que lea
// req.body.token (qrTokenKey/inviteTokenKey) — nunca al revés, o el body
// llegaría vacío a esas claves.
app.use(express.json({ limit: '50kb' }));
// ─── Rate limiting ────────────────────────────────────────────────────────────
// Un seminario pone a todo el mundo en UNA sola IP de recinto: el límite
// original de /api/auth (20 por IP/15 min) alcanzaba para que solo ~7
// personas terminaran de unirse (consultar + aceptar + auto-login cada una).
// Por eso cada flujo público de alta cuenta con DOS límites combinados: uno
// amplio por IP (protege contra un ataque real) y uno fino por identidad
// (token o cuenta), para que un grupo legítimo en una misma IP no se ahogue
// entre sí — ver lib/rate-limits.ts para el detalle de cada clave.
// Login: fuerza bruta acotada por cuenta (IP + email) y un techo amplio por IP.
app.use('/api/auth/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: loginKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión, intenta más tarde' },
}));
app.use('/api/auth/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión, intenta más tarde' },
}));
// Invitaciones públicas (consultar/aceptar): amplio por IP + fino por token.
app.use('/api/auth/invitaciones', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de invitaciones, intenta más tarde' },
}));
app.use('/api/auth/invitaciones', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: inviteTokenKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de invitaciones, intenta más tarde' },
}));
// Resto de /api/auth (verify/forgot-password/reset-password): el límite
// original, sin tocar — login e invitaciones ya tienen el suyo propio arriba,
// así que cada request queda gobernada por UNA sola familia de límites.
app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skip: isAuthSubpathWithOwnLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de autenticación, intenta más tarde' },
}));
// Límite específico para invitaciones autenticadas (ADMIN/LIDER, envían
// correo) — cubre también /api/invitaciones/qr/* (gestión del QR reusable).
// GET .../qr/:id/estado queda afuera (ver isQrEstadoPath): tiene su propio
// límite, más abajo.
app.use('/api/invitaciones', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    skip: isQrEstadoPath,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de invitaciones, intenta más tarde' },
}));
// GET /api/invitaciones/qr/:id/estado: lo polea la pantalla de quien generó
// un QR directo cada pocos segundos mientras espera un escaneo — límite
// propio y amplio, por usuario autenticado (no por IP: varios ADMIN/LIDER
// del mismo recinto no deben ahogarse entre sí). Ver isQrEstadoPath/
// isOwnRateLimitFamily en lib/rate-limits.ts para las dos exenciones que lo
// sacan de las familias de arriba y de la general de "/api" más abajo.
app.use('/api/invitaciones/qr/:id/estado', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    keyGenerator: verifiedUserOrIpKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes, intenta más tarde' },
}));
// QR público (consultar/solicitar/registrar): amplio por IP + fino por token
// del QR para el endpoint que efectivamente consume un uso.
app.use('/api/qr', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes, intenta más tarde' },
}));
app.use('/api/qr/solicitar', rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 400,
    keyGenerator: qrTokenKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes para este código QR, intenta más tarde' },
}));
// Un QR directo sirve UNA sola vez: un tope mucho más bajo que /solicitar
// (que mintea invitaciones repetibles) alcanza de sobra para el uso legítimo
// (unos pocos intentos fallidos de contraseña/email) y frena cualquier
// intento de fuerza bruta contra un token capturado.
app.use('/api/qr/registrar', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: qrTokenKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes para este código QR, intenta más tarde' },
}));
// Límite general para el resto de la API: por usuario autenticado (JWT ya
// verificado) cuando hay sesión, o por IP si no la hay — /auth y /qr quedan
// afuera porque ya tienen su propia familia de límites arriba.
app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    keyGenerator: verifiedUserOrIpKey,
    skip: isOwnRateLimitFamily,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes, intenta más tarde' },
}));
// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);
// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});
export default app;
