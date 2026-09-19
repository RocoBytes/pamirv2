import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import apiRouter from './routes/index.js';

const app: Application = express();

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
  origin: (origin: string | undefined, callback: (err: Error | null, origin?: string | boolean) => void) => {
    const allowed =
      !origin ||
      (FRONTEND_URL
        ? origin === FRONTEND_URL || ADDITIONAL_ORIGINS.includes(origin)
        : DEV_ORIGINS.includes(origin));
    callback(null, allowed ? origin : false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '50kb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Límite estricto para endpoints de autenticación (fuerza bruta / spam de emails)
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de autenticación, intenta más tarde' },
}));

// Límite general para el resto de la API
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta más tarde' },
}));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

export default app;
