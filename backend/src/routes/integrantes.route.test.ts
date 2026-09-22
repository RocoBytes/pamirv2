import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// integrantes.route.ts importa el controlador, que a su vez importa
// src/lib/prisma.ts y src/lib/google-gmail.ts: prisma.ts lanza al importarse
// si DATABASE_URL no está definida (estos tests no cargan dotenv). No se abre
// ninguna conexión real: prisma.ts solo construye el adaptador de pg
// (perezoso hasta la primera query), y estos tests nunca ejecutan una. El
// import dinámico evita que el módulo se cargue antes de fijar esta variable.
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

async function loadRouterStack(): Promise<StackLayer[]> {
  const { default: router } = await import('./integrantes.route.js');
  return (router as unknown as { stack: StackLayer[] }).stack;
}

async function loadRequireAuth(): Promise<Handler> {
  const { requireAuth } = await import('../middleware/auth.middleware.js');
  return requireAuth as unknown as Handler;
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

describe('integrantes.route — cierre de acceso anónimo', () => {
  it('todas las rutas exigen requireAuth en su cadena de handlers', async () => {
    const stack = await loadRouterStack();
    const requireAuth = await loadRequireAuth();

    const routeEntries: { method: string; path: string; index: number }[] = [];
    stack.forEach((layer, index) => {
      if (!layer.route) return;
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) routeEntries.push({ method, path: layer.route.path, index });
      }
    });

    assert.ok(routeEntries.length > 0, 'se esperaba encontrar rutas registradas en integrantes.route.ts');

    for (const entry of routeEntries) {
      assert.equal(
        routeRequiresAuth(stack, entry.index, requireAuth),
        true,
        `${entry.method.toUpperCase()} ${entry.path} debe exigir requireAuth`,
      );
    }
  });

  it('expone GET /by-rut/:rut protegida (regresión del hueco cerrado)', async () => {
    const stack = await loadRouterStack();
    const requireAuth = await loadRequireAuth();
    const index = stack.findIndex((layer) => layer.route?.path === '/by-rut/:rut' && layer.route.methods['get']);
    assert.notEqual(index, -1);
    assert.equal(routeRequiresAuth(stack, index, requireAuth), true);
  });
});
