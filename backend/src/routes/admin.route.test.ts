import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// admin.route.ts importa el controlador, que a su vez importa
// src/lib/prisma.ts y src/lib/jwt.ts: ambos lanzan al importarse si
// DATABASE_URL/JWT_SECRET no están definidas (estos tests no cargan dotenv).
// No se abre ninguna conexión real: prisma.ts solo construye el adaptador de
// pg (perezoso hasta la primera query), y estos tests nunca ejecutan una. El
// import dinámico evita que el módulo se cargue antes de fijar estas variables.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

async function loadRouterLayers(): Promise<RouteLayer[]> {
  const { default: router } = await import('./admin.route.js');
  return (router as unknown as { stack: RouteLayer[] }).stack;
}

function hasRoute(layers: RouteLayer[], path: string, method: string): boolean {
  return layers.some((layer) => layer.route?.path === path && layer.route.methods[method]);
}

describe('admin.route', () => {
  it('expone GET /users', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/users', 'get'), true);
  });

  it('expone PATCH /users/:id/rol', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/users/:id/rol', 'patch'), true);
  });
});
