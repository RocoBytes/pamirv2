import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Este archivo carga (dinámicamente) todos los routers montados bajo /api,
// que a su vez importan src/lib/prisma.ts y src/lib/jwt.ts: ambos lanzan al
// importarse si DATABASE_URL/JWT_SECRET no están definidas (estos tests no
// cargan dotenv). No se abre ninguna conexión real: prisma.ts solo construye
// el adaptador de pg (perezoso hasta la primera query), y estos tests nunca
// ejecutan una.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

type Handler = (...args: unknown[]) => unknown;

interface StackLayer {
  handle: Handler;
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: Handler }[];
  };
}

interface PublicRouteEntry {
  method: string;
  path: string;
}

// Espejo de los router.use(...) de routes/index.ts. Si se monta un router
// nuevo ahí sin agregarlo aquí, la prueba de conteo de abajo falla y obliga a
// revisar explícitamente su superficie pública.
const ROUTERS: { prefix: string; modulePath: string }[] = [
  { prefix: '/health', modulePath: './health.route.js' },
  { prefix: '/auth', modulePath: './auth.route.js' },
  { prefix: '/me', modulePath: './me.route.js' },
  { prefix: '/salidas', modulePath: './salidas.route.js' },
  { prefix: '/salidas', modulePath: './upload.route.js' },
  { prefix: '/integrantes', modulePath: './integrantes.route.js' },
  { prefix: '/cierres', modulePath: './cierres.route.js' },
  { prefix: '/evaluaciones', modulePath: './evaluaciones.route.js' },
  { prefix: '/documentos', modulePath: './documentos.route.js' },
  { prefix: '/eventos', modulePath: './eventos.route.js' },
  { prefix: '/cron', modulePath: './cron.route.js' },
  { prefix: '/admin', modulePath: './admin.route.js' },
  { prefix: '/invitaciones', modulePath: './invitaciones.route.js' },
  { prefix: '/organizacion', modulePath: './organizacion.route.js' },
  { prefix: '/clubes', modulePath: './clubes.route.js' },
  { prefix: '/qr', modulePath: './qr-publico.route.js' },
];

// Lista cerrada de rutas que SÍ pueden responder sin una sesión válida.
// Cualquier otra ruta anónima detectada hace fallar este test: agregar una
// entrada aquí es una decisión explícita, no un accidente.
const PUBLIC_ROUTES: PublicRouteEntry[] = [
  // Ping anti-cold-start: no toca la base de datos ni expone datos.
  { method: 'GET', path: '/api/health' },
  // Login: es el mecanismo para obtener una sesión, no puede exigir una.
  { method: 'POST', path: '/api/auth/login' },
  // Verificación de email tras crear/restablecer cuenta: va con un token propio.
  { method: 'GET', path: '/api/auth/verify/:token' },
  // Recuperación de contraseña: el usuario todavía no tiene sesión.
  { method: 'POST', path: '/api/auth/forgot-password' },
  { method: 'POST', path: '/api/auth/reset-password' },
  // Sistema cerrado: consultar/aceptar una invitación es cómo se crea la cuenta.
  { method: 'POST', path: '/api/auth/invitaciones/consultar' },
  { method: 'POST', path: '/api/auth/invitaciones/aceptar' },
  // Evaluación post-salida: formulario anónimo protegido por un token de un solo uso.
  { method: 'GET', path: '/api/evaluaciones/:token' },
  { method: 'POST', path: '/api/evaluaciones/:token' },
  // Cronjob del VPS: protegido por CRON_SECRET (query param), no por sesión.
  { method: 'GET', path: '/api/cron/check-alertas' },
  // Marca y logo del club por slug: pantallas SIN sesión (login previo a
  // autenticar) necesitan poder pintarlos — ver clubes.controller.ts.
  { method: 'GET', path: '/api/clubes/:slug/marca' },
  { method: 'GET', path: '/api/clubes/:slug/logo' },
  // QR reusable del club: consultar la marca antes de pedir la propia
  // invitación es, a propósito, tan público como consultar una invitación
  // individual — ver codigos-qr.controller.ts.
  { method: 'POST', path: '/api/qr/consultar' },
  { method: 'POST', path: '/api/qr/solicitar' },
  // QR directo: da de alta la cuenta en el acto, sin sesión previa (es el
  // mecanismo para CREAR la cuenta) — mismo motivo que /api/qr/solicitar.
  { method: 'POST', path: '/api/qr/registrar' },
];

function joinPath(prefix: string, routePath: string): string {
  return routePath === '/' ? prefix : `${prefix}${routePath}`;
}

function sortEntries(a: PublicRouteEntry, b: PublicRouteEntry): number {
  return a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path);
}

// Una ruta exige sesión si requireAuth aparece antes que ella como middleware
// global del router (router.use), o dentro de su propia cadena de handlers.
function routeRequiresAuth(stack: StackLayer[], routeIndex: number, requireAuthFn: Handler): boolean {
  const precededByGlobalAuth = stack
    .slice(0, routeIndex)
    .some((layer) => !layer.route && layer.handle === requireAuthFn);
  if (precededByGlobalAuth) return true;

  const route = stack[routeIndex]?.route;
  return Boolean(route?.stack.some((h) => h.handle === requireAuthFn));
}

async function collectPublicRoutes(): Promise<PublicRouteEntry[]> {
  const { requireAuth } = await import('../middleware/auth.middleware.js');
  const requireAuthFn = requireAuth as unknown as Handler;
  const results: PublicRouteEntry[] = [];

  for (const { prefix, modulePath } of ROUTERS) {
    const { default: router } = await import(modulePath);
    const stack = (router as unknown as { stack: StackLayer[] }).stack;

    stack.forEach((layer, index) => {
      if (!layer.route) return;
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (!enabled) continue;
        if (routeRequiresAuth(stack, index, requireAuthFn)) continue;
        results.push({ method: method.toUpperCase(), path: `/api${joinPath(prefix, layer.route.path)}` });
      }
    });
  }

  return results;
}

describe('public-routes — superficie pública del API (allowlist)', () => {
  it('el número de routers montados en /api no cambió sin actualizar este test', async () => {
    const { default: apiRouter } = await import('./index.js');
    const stack = (apiRouter as unknown as { stack: unknown[] }).stack;
    assert.equal(
      stack.length,
      ROUTERS.length,
      'Se montó/quitó un router en routes/index.ts: actualiza ROUTERS en este archivo y revisa su exposición pública',
    );
  });

  it('la única superficie alcanzable sin sesión es la lista permitida', async () => {
    const actual = (await collectPublicRoutes()).sort(sortEntries);
    const expected = [...PUBLIC_ROUTES].sort(sortEntries);
    assert.deepEqual(actual, expected);
  });
});
