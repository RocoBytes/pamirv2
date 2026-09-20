import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';

// auth.middleware.ts importa src/lib/prisma.ts y src/lib/jwt.ts, que lanzan
// al importarse si DATABASE_URL/JWT_SECRET no están definidas (estos tests no
// cargan dotenv). No se abre ninguna conexión real: prisma.ts solo construye
// el adaptador de pg (perezoso hasta la primera query), y estos tests nunca
// ejecutan una. El import dinámico evita que el módulo se cargue antes de
// fijar estas variables.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

async function loadRequireAdmin() {
  const { requireAdmin } = await import('./auth.middleware.js');
  return requireAdmin;
}

function fakeResponse(): Response & { statusCode?: number; body?: unknown } {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  } as unknown as Response & { statusCode?: number; body?: unknown };
  return res;
}

function fakeNext(): { next: NextFunction; state: { called: boolean } } {
  const state = { called: false };
  const next = (() => {
    state.called = true;
  }) as NextFunction;
  return { next, state };
}

describe('requireAdmin', () => {
  it('calls next() for a user with rol ADMIN', async () => {
    const requireAdmin = await loadRequireAdmin();
    const req = { user: { id: '1', email: 'admin@club.cl', name: 'Admin', rol: 'ADMIN' } } as unknown as Request;
    const res = fakeResponse();
    const { next, state } = fakeNext();

    requireAdmin(req, res, next);

    assert.equal(state.called, true);
    assert.equal(res.statusCode, undefined);
  });

  it('responds 403 and does not call next() for a user with rol SOCIO', async () => {
    const requireAdmin = await loadRequireAdmin();
    const req = { user: { id: '2', email: 'socio@club.cl', name: 'Socio', rol: 'SOCIO' } } as unknown as Request;
    const res = fakeResponse();
    const { next, state } = fakeNext();

    requireAdmin(req, res, next);

    assert.equal(state.called, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Acceso restringido al administrador' });
  });

  it('responds 403 when there is no user', async () => {
    const requireAdmin = await loadRequireAdmin();
    const req = { user: null } as unknown as Request;
    const res = fakeResponse();
    const { next, state } = fakeNext();

    requireAdmin(req, res, next);

    assert.equal(state.called, false);
    assert.equal(res.statusCode, 403);
  });

  it('responds 403 for the legacy admin mailbox with rol SOCIO', async () => {
    const requireAdmin = await loadRequireAdmin();
    const req = {
      user: { id: '3', email: 'seguridad.acp.cl@gmail.com', name: 'Legacy', rol: 'SOCIO' },
    } as unknown as Request;
    const res = fakeResponse();
    const { next, state } = fakeNext();

    requireAdmin(req, res, next);

    assert.equal(state.called, false);
    assert.equal(res.statusCode, 403);
  });
});
