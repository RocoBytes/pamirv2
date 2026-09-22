import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// invitaciones.route.ts importa el controlador, que a su vez importa
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
  const { default: router } = await import('./invitaciones.route.js');
  return (router as unknown as { stack: RouteLayer[] }).stack;
}

function hasRoute(layers: RouteLayer[], path: string, method: string): boolean {
  return layers.some((layer) => layer.route?.path === path && layer.route.methods[method]);
}

describe('invitaciones.route', () => {
  it('expone POST / (crear invitación)', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/', 'post'), true);
  });

  it('expone GET / (listar invitaciones)', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/', 'get'), true);
  });

  it('expone POST /:id/revocar', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/:id/revocar', 'post'), true);
  });

  it('expone POST /:id/reenviar', async () => {
    const layers = await loadRouterLayers();
    assert.equal(hasRoute(layers, '/:id/reenviar', 'post'), true);
  });
});
