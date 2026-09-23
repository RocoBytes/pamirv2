// Funciones puras (sin I/O de red) que deciden la CLAVE o si se SALTA un
// limitador de tasa, separadas de app.ts para poder probarlas con un `Request`
// de mentira, sin levantar Express. app.ts las cablea dentro de cada
// `rateLimit({...})` — ver el comentario de contexto ahí: un seminario pone a
// todo el mundo en UNA sola IP de recinto, así que un límite pensado para
// tráfico normal (por IP) ahogaría a un grupo entero si no se combina con un
// límite más fino (por token, por cuenta).
import { createHash } from 'crypto';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { verifyToken } from './jwt.js';

// Nunca la IP a secas: ipKeyGenerator normaliza IPv6 a su subred (ver el
// comentario de la librería) — un cliente IPv6 con una dirección distinta en
// cada request no debe esquivar el límite.
function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '');
}

function normalizeEmailForKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// IP + email normalizado: usado por el límite de fuerza bruta de
// POST /api/auth/login (10 por 15 min). Un email vacío/ausente colapsa a la
// cadena vacía — sigue siendo una clave válida (agrupa los intentos sin
// email bajo esa IP), nunca lanza.
export function loginKey(req: Request): string {
  return `${ipKey(req)}:${normalizeEmailForKey(req.body?.email)}`;
}

function tokenHashKey(req: Request): string {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  return createHash('sha256').update(token).digest('hex');
}

// sha256 del token del body — nunca el token en claro como clave (evita que
// quede en logs/memoria del store tal cual), y nunca el token en la URL
// (ambos endpoints reciben el token siempre por body).
export const qrTokenKey = tokenHashKey;
export const inviteTokenKey = tokenHashKey;

// Usuario autenticado (id del JWT ya VERIFICADO, nunca uno leído sin
// comprobar la firma) si hay un Bearer válido; si no, cae a la IP. Así un
// usuario logueado no se ve arrastrado por el límite de otros en su misma IP
// (p. ej. el mismo seminario), y una request anónima sigue acotada por IP.
export function verifiedUserOrIpKey(req: Request): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const { userId } = verifyToken(auth.slice(7));
      return `user:${userId}`;
    } catch {
      // Token inválido/expirado: se trata como anónimo, cae a la IP.
    }
  }
  return ipKey(req);
}

// req.path ya es relativo al punto de montaje del middleware (Express le
// recorta el prefijo) — ver el comentario de app.ts sobre dónde se monta
// cada limitador.

// Para el limitador general de "/api/auth" (20/IP): las subrutas con su
// propio límite más fino (login, invitaciones) quedan afuera para que cada
// request quede gobernada por UNA sola familia de límites, nunca dos.
export function isAuthSubpathWithOwnLimit(req: Request): boolean {
  return req.path === '/login' || req.path.startsWith('/invitaciones/');
}

// GET /api/invitaciones/qr/:id/estado: lo polea la pantalla de quien generó
// un QR directo mientras espera que alguien lo escanee, cada pocos segundos.
// El límite de 60/15min pensado para gestionar invitaciones (crear, listar,
// revocar) ahogaría ese polling en cualquier evento con más de un puñado de
// personas registrándose — queda afuera de esa familia y de la de "/api"
// (ver isOwnRateLimitFamily) con su propio límite, más amplio, en app.ts.
const QR_ESTADO_SUBPATH_RE = /^\/qr\/[^/]+\/estado$/;
export function isQrEstadoPath(req: Request): boolean {
  return QR_ESTADO_SUBPATH_RE.test(req.path);
}

// Mismo patrón que arriba, pero relativo al punto de montaje de "/api" (no al
// de "/api/invitaciones"): lo usa isOwnRateLimitFamily.
const QR_ESTADO_FROM_API_RE = /^\/invitaciones\/qr\/[^/]+\/estado$/;

// Para el limitador general de "/api" (300, por usuario o IP): /auth y /qr
// tienen sus propias familias de límites, y GET .../qr/:id/estado también
// (ver arriba) — mismo motivo que isAuthSubpathWithOwnLimit.
export function isOwnRateLimitFamily(req: Request): boolean {
  return (
    req.path === '/auth' ||
    req.path.startsWith('/auth/') ||
    req.path === '/qr' ||
    req.path.startsWith('/qr/') ||
    QR_ESTADO_FROM_API_RE.test(req.path)
  );
}
