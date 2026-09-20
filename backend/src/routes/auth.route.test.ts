import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// auth.route.ts importa el controlador, que a su vez importa src/lib/prisma.ts
// y src/lib/jwt.ts: ambos lanzan al importarse si DATABASE_URL/JWT_SECRET no
// están definidas (estos tests no cargan dotenv). No se abre ninguna conexión
// real: prisma.ts solo construye el adaptador de pg (perezoso hasta la primera
// query), y estos tests nunca ejecutan una. El import dinámico evita que el
// módulo se cargue antes de fijar estas variables.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

async function loadRouterLayers(): Promise<RouteLayer[]> {
  const { default: router } = await import('./auth.route.js');
  return (router as unknown as { stack: RouteLayer[] }).stack;
}

function hasRoute(layers: RouteLayer[], path: string, method: string): boolean {
  return layers.some((layer) => layer.route?.path === path && layer.route.methods[method]);
}

describe('auth.route', () => {
  it('no expone /register en ningún método (cierre del registro)', async () => {
    const layers = await loadRouterLayers();
    const registerLayers = layers.filter((layer) => layer.route?.path === '/register');
    assert.deepEqual(registerLayers, []);
  });

  it('mantiene POST /login', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/login', 'post'), true);
  });

  it('mantiene GET /verify/:token', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/verify/:token', 'get'), true);
  });

  it('mantiene POST /forgot-password', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/forgot-password', 'post'), true);
  });

  it('mantiene POST /reset-password', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/reset-password', 'post'), true);
  });
});
