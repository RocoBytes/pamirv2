import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// verified-email.ts importa lib/jwt.ts, que lanza al importarse si JWT_SECRET
// no está definida (estos tests no cargan dotenv). Se fija ANTES y se importa
// dinámicamente — un `import` estático se evalúa antes que cualquier código
// de este archivo, así que fijar la variable primero no serviría de nada —
// mismo patrón que rate-limits.test.ts / public-routes.test.ts.
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

const { signToken } = await import('./jwt.js');
const { verifiedEmailFromAuthHeader } = await import('./verified-email.js');

describe('verifiedEmailFromAuthHeader', () => {
  it('returns the verified email from a valid Bearer token', () => {
    const token = signToken({ userId: 'user-1', email: 'ana@club.cl' });
    assert.equal(verifiedEmailFromAuthHeader({ headers: { authorization: `Bearer ${token}` } }), 'ana@club.cl');
  });

  it('returns null when there is no Authorization header', () => {
    assert.equal(verifiedEmailFromAuthHeader({ headers: {} }), null);
  });

  it('returns null when the header is not a Bearer token', () => {
    assert.equal(verifiedEmailFromAuthHeader({ headers: { authorization: 'Basic abc123' } }), null);
  });

  it('returns null for a malformed/invalid token — never throws', () => {
    assert.equal(verifiedEmailFromAuthHeader({ headers: { authorization: 'Bearer not-a-real-jwt' } }), null);
  });

  it('returns null for an expired or tampered token — signature verification, not just decoding', () => {
    const token = signToken({ userId: 'user-1', email: 'ana@club.cl' });
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    assert.equal(verifiedEmailFromAuthHeader({ headers: { authorization: `Bearer ${tampered}` } }), null);
  });
});
