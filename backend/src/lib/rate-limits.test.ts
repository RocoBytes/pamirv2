import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';

// rate-limits.ts importa lib/jwt.ts, que lanza al importarse si JWT_SECRET no
// está definida (estos tests no cargan dotenv). Se fija ANTES y se importa
// dinámicamente — un `import` estático se evalúa antes que cualquier código
// de este archivo, así que fijar la variable primero no serviría de nada —
// mismo patrón que invitaciones.route.test.ts / public-routes.test.ts.
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

const {
  loginKey,
  qrTokenKey,
  inviteTokenKey,
  verifiedUserOrIpKey,
  isAuthSubpathWithOwnLimit,
  isOwnRateLimitFamily,
  isQrEstadoPath,
} = await import('./rate-limits.js');

// `Request` de mentira: solo lo mínimo que leen las funciones puras de este
// archivo, nunca un servidor Express real.
interface FakeRequest {
  ip?: string;
  body?: Record<string, unknown>;
  path: string;
  headers: Record<string, string | undefined>;
}

function fakeReq(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return { ip: '203.0.113.10', body: {}, path: '/', headers: {}, ...overrides };
}

describe('loginKey', () => {
  it('combina IP y email normalizado', () => {
    const key = loginKey(fakeReq({ body: { email: '  Persona@Club.CL  ' } }) as never);
    assert.match(key, /^203\.0\.113\.10:persona@club\.cl$/);
  });

  it('dos emails que solo difieren en mayúsculas/espacios producen la misma clave', () => {
    const a = loginKey(fakeReq({ body: { email: 'Ana@Club.cl' } }) as never);
    const b = loginKey(fakeReq({ body: { email: '  ana@club.cl  ' } }) as never);
    assert.equal(a, b);
  });

  it('un email ausente no lanza y produce una clave válida', () => {
    assert.doesNotThrow(() => loginKey(fakeReq({ body: {} }) as never));
    assert.doesNotThrow(() => loginKey(fakeReq({ body: undefined }) as never));
  });

  it('emails distintos en la misma IP producen claves distintas', () => {
    const a = loginKey(fakeReq({ body: { email: 'ana@club.cl' } }) as never);
    const b = loginKey(fakeReq({ body: { email: 'beto@club.cl' } }) as never);
    assert.notEqual(a, b);
  });
});

describe('qrTokenKey / inviteTokenKey', () => {
  it('es el sha256 hex del token del body', () => {
    const token = 'un-token-cualquiera';
    const expected = createHash('sha256').update(token).digest('hex');
    assert.equal(qrTokenKey(fakeReq({ body: { token } }) as never), expected);
    assert.equal(inviteTokenKey(fakeReq({ body: { token } }) as never), expected);
  });

  it('nunca incluye el token en claro', () => {
    const token = 'token-secreto-no-debe-aparecer';
    const key = qrTokenKey(fakeReq({ body: { token } }) as never);
    assert.equal(key.includes(token), false);
  });

  it('un token ausente no lanza (colapsa al hash de la cadena vacía)', () => {
    const key = qrTokenKey(fakeReq({ body: {} }) as never);
    assert.equal(key, createHash('sha256').update('').digest('hex'));
  });

  it('dos tokens distintos producen claves distintas', () => {
    const a = qrTokenKey(fakeReq({ body: { token: 'token-a' } }) as never);
    const b = qrTokenKey(fakeReq({ body: { token: 'token-b' } }) as never);
    assert.notEqual(a, b);
  });
});

describe('verifiedUserOrIpKey', () => {
  it('con un Bearer válido usa "user:<id>"', () => {
    const token = jwt.sign({ userId: 'user-123', email: 'a@club.cl' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const req = fakeReq({ headers: { authorization: `Bearer ${token}` } });
    assert.equal(verifiedUserOrIpKey(req as never), 'user:user-123');
  });

  it('sin Authorization cae a la IP', () => {
    const req = fakeReq({ ip: '198.51.100.7' });
    assert.equal(verifiedUserOrIpKey(req as never), '198.51.100.7');
  });

  it('con un Bearer inválido (firma equivocada) cae a la IP, nunca lanza ni confía en el payload', () => {
    const forged = jwt.sign({ userId: 'atacante' }, 'otra-clave-distinta', { expiresIn: '1h' });
    const req = fakeReq({ ip: '198.51.100.7', headers: { authorization: `Bearer ${forged}` } });
    assert.doesNotThrow(() => verifiedUserOrIpKey(req as never));
    assert.equal(verifiedUserOrIpKey(req as never), '198.51.100.7');
  });

  it('con un Bearer expirado cae a la IP', () => {
    const expired = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!, { expiresIn: -10 });
    const req = fakeReq({ ip: '198.51.100.7', headers: { authorization: `Bearer ${expired}` } });
    assert.equal(verifiedUserOrIpKey(req as never), '198.51.100.7');
  });

  it('con un header Authorization que no es Bearer cae a la IP', () => {
    const req = fakeReq({ ip: '198.51.100.7', headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    assert.equal(verifiedUserOrIpKey(req as never), '198.51.100.7');
  });
});

describe('isAuthSubpathWithOwnLimit', () => {
  it('true para /login', () => {
    assert.equal(isAuthSubpathWithOwnLimit(fakeReq({ path: '/login' }) as never), true);
  });

  it('true para cualquier /invitaciones/*', () => {
    assert.equal(isAuthSubpathWithOwnLimit(fakeReq({ path: '/invitaciones/consultar' }) as never), true);
    assert.equal(isAuthSubpathWithOwnLimit(fakeReq({ path: '/invitaciones/aceptar' }) as never), true);
  });

  it('false para el resto de /api/auth', () => {
    assert.equal(isAuthSubpathWithOwnLimit(fakeReq({ path: '/verify/tok' }) as never), false);
    assert.equal(isAuthSubpathWithOwnLimit(fakeReq({ path: '/forgot-password' }) as never), false);
    assert.equal(isAuthSubpathWithOwnLimit(fakeReq({ path: '/reset-password' }) as never), false);
  });
});

describe('isOwnRateLimitFamily', () => {
  it('true para /auth y cualquier /auth/*', () => {
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/auth' }) as never), true);
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/auth/login' }) as never), true);
  });

  it('true para /qr y cualquier /qr/*', () => {
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/qr' }) as never), true);
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/qr/solicitar' }) as never), true);
  });

  it('true para GET .../invitaciones/qr/:id/estado (relativo a /api)', () => {
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/invitaciones/qr/abc-123/estado' }) as never), true);
  });

  it('false para el resto de /api/invitaciones/qr/*', () => {
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/invitaciones/qr' }) as never), false);
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/invitaciones/qr/abc-123' }) as never), false);
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/invitaciones/qr/abc-123/revocar' }) as never), false);
  });

  it('false para el resto de /api', () => {
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/invitaciones' }) as never), false);
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/salidas' }) as never), false);
  });

  it('no confunde un prefijo parecido (p.ej. "/authx") con la familia real', () => {
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/authx' }) as never), false);
    assert.equal(isOwnRateLimitFamily(fakeReq({ path: '/qrcode' }) as never), false);
  });
});

describe('isQrEstadoPath', () => {
  it('true para /qr/:id/estado (relativo a /api/invitaciones)', () => {
    assert.equal(isQrEstadoPath(fakeReq({ path: '/qr/abc-123/estado' }) as never), true);
  });

  it('false para el resto de /qr/*', () => {
    assert.equal(isQrEstadoPath(fakeReq({ path: '/qr' }) as never), false);
    assert.equal(isQrEstadoPath(fakeReq({ path: '/qr/abc-123' }) as never), false);
    assert.equal(isQrEstadoPath(fakeReq({ path: '/qr/abc-123/revocar' }) as never), false);
  });

  it('false para el resto de /api/invitaciones', () => {
    assert.equal(isQrEstadoPath(fakeReq({ path: '/' }) as never), false);
    assert.equal(isQrEstadoPath(fakeReq({ path: '/abc-123/revocar' }) as never), false);
  });
});
