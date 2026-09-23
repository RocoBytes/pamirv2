import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin, canInvite, gestionaTodasLasCategorias, puedeGestionarSalida } from './authz.js';

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

describe('gestionaTodasLasCategorias', () => {
  it('returns true for a user with rol LIDER', () => {
    assert.equal(gestionaTodasLasCategorias({ rol: 'LIDER' }), true);
  });

  it('returns false for a user with rol SOCIO', () => {
    assert.equal(gestionaTodasLasCategorias({ rol: 'SOCIO' }), false);
  });

  it('returns false for a user with rol ADMIN (maneja todo por otra vía, no por esta)', () => {
    assert.equal(gestionaTodasLasCategorias({ rol: 'ADMIN' }), false);
  });

  it('returns false for an undefined user', () => {
    assert.equal(gestionaTodasLasCategorias(undefined), false);
  });

  it('returns false for a null user', () => {
    assert.equal(gestionaTodasLasCategorias(null), false);
  });
});

describe('puedeGestionarSalida', () => {
  const admin = { id: 'admin-1', rol: 'ADMIN' };
  const owner = { id: 'owner-1', rol: 'SOCIO' };
  const otro = { id: 'otro-1', rol: 'SOCIO' };
  const lider = { id: 'lider-1', rol: 'LIDER' };

  it('el admin puede gestionar una salida con dueño', () => {
    assert.equal(puedeGestionarSalida(admin, { userId: owner.id }), true);
  });

  it('el admin puede gestionar una salida sin dueño (legada)', () => {
    assert.equal(puedeGestionarSalida(admin, { userId: null }), true);
  });

  it('el dueño puede gestionar su propia salida', () => {
    assert.equal(puedeGestionarSalida(owner, { userId: owner.id }), true);
  });

  it('un usuario no-admin y no-dueño no puede gestionar la salida', () => {
    assert.equal(puedeGestionarSalida(otro, { userId: owner.id }), false);
  });

  it('un usuario no-admin no puede gestionar una salida sin dueño', () => {
    assert.equal(puedeGestionarSalida(otro, { userId: null }), false);
  });

  it('un SOCIO nunca calza contra userId null aunque comparta id por accidente', () => {
    // userId null jamás es === al id de un usuario real, sea cual sea.
    assert.equal(puedeGestionarSalida(owner, { userId: null }), false);
  });

  it('un LIDER se comporta igual que un SOCIO (sin permiso extra sobre salidas)', () => {
    assert.equal(puedeGestionarSalida(lider, { userId: lider.id }), true);
    assert.equal(puedeGestionarSalida(lider, { userId: null }), false);
    assert.equal(puedeGestionarSalida(lider, { userId: owner.id }), false);
  });

  it('retorna false cuando no hay usuario autenticado', () => {
    assert.equal(puedeGestionarSalida(null, { userId: owner.id }), false);
    assert.equal(puedeGestionarSalida(undefined, { userId: null }), false);
  });
});
