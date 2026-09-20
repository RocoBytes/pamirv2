import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin, canInvite } from './authz.js';

describe('isAdmin', () => {
  it('returns true for a user with rol ADMIN', () => {
    assert.equal(isAdmin({ rol: 'ADMIN' }), true);
  });

  it('returns false for a user with rol SOCIO', () => {
    assert.equal(isAdmin({ rol: 'SOCIO' }), false);
  });

  it('returns false for an undefined user', () => {
    assert.equal(isAdmin(undefined), false);
  });

  it('returns false for a null user', () => {
    assert.equal(isAdmin(null), false);
  });

  it('returns false when rol is missing', () => {
    assert.equal(isAdmin({}), false);
  });

  it('returns false for a lowercase "admin" value', () => {
    assert.equal(isAdmin({ rol: 'admin' }), false);
  });

  it('returns false for the legacy admin email with rol SOCIO', () => {
    const user = { email: 'seguridad.acp.cl@gmail.com', rol: 'SOCIO' };
    assert.equal(isAdmin(user), false);
  });
});

describe('canInvite', () => {
  it('returns true for a user with rol ADMIN', () => {
    assert.equal(canInvite({ rol: 'ADMIN' }), true);
  });

  it('returns true for a user with rol LIDER', () => {
    assert.equal(canInvite({ rol: 'LIDER' }), true);
  });

  it('returns false for a user with rol SOCIO', () => {
    assert.equal(canInvite({ rol: 'SOCIO' }), false);
  });

  it('returns false for an undefined user', () => {
    assert.equal(canInvite(undefined), false);
  });

  it('returns false for a null user', () => {
    assert.equal(canInvite(null), false);
  });

  it('returns false when rol is missing', () => {
    assert.equal(canInvite({}), false);
  });
});
