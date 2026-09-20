import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_TTL_MS,
  generateInviteToken,
  hashInviteToken,
  rolesInvitables,
  puedeInvitarRol,
  estadoInvitacion,
  ROL_LABELS,
  puedeCambiarRol,
} from './invitaciones.js';

describe('generateInviteToken / hashInviteToken', () => {
  it('genera un token url-safe de 43 caracteres', () => {
    const { token } = generateInviteToken();
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  it('el hash tiene 64 caracteres hexadecimales', () => {
    const { tokenHash } = generateInviteToken();
    assert.equal(tokenHash.length, 64);
    assert.match(tokenHash, /^[a-f0-9]+$/);
  });

  it('hashInviteToken es determinístico', () => {
    const { token } = generateInviteToken();
    assert.equal(hashInviteToken(token), hashInviteToken(token));
  });

  it('dos tokens generados son distintos', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    assert.notEqual(a.token, b.token);
  });

  it('el hash no contiene el token en claro', () => {
    const { token, tokenHash } = generateInviteToken();
    assert.equal(tokenHash.includes(token), false);
  });
});

describe('INVITE_TTL_MS', () => {
  it('equivale a 7 días', () => {
    assert.equal(INVITE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  });
});

describe('rolesInvitables / puedeInvitarRol', () => {
  it('ADMIN puede invitar SOCIO, LIDER y ADMIN', () => {
    assert.deepEqual(rolesInvitables('ADMIN'), ['SOCIO', 'LIDER', 'ADMIN']);
  });

  it('LIDER solo puede invitar SOCIO', () => {
    assert.deepEqual(rolesInvitables('LIDER'), ['SOCIO']);
  });

  it('SOCIO no puede invitar a nadie', () => {
    assert.deepEqual(rolesInvitables('SOCIO'), []);
  });

  it('un rol desconocido no puede invitar a nadie', () => {
    assert.deepEqual(rolesInvitables('OTRO'), []);
  });

  it('puedeInvitarRol refleja rolesInvitables', () => {
    assert.equal(puedeInvitarRol('ADMIN', 'ADMIN'), true);
    assert.equal(puedeInvitarRol('LIDER', 'SOCIO'), true);
    assert.equal(puedeInvitarRol('LIDER', 'LIDER'), false);
    assert.equal(puedeInvitarRol('LIDER', 'ADMIN'), false);
    assert.equal(puedeInvitarRol('SOCIO', 'SOCIO'), false);
  });
});

describe('estadoInvitacion', () => {
  const now = new Date('2026-01-08T00:00:00.000Z');
  const futuro = new Date('2026-01-15T00:00:00.000Z');
  const pasado = new Date('2026-01-01T00:00:00.000Z');

  it('ACEPTADA tiene precedencia sobre todo', () => {
    const inv = { aceptadaAt: now, revocadaAt: now, expiresAt: pasado };
    assert.equal(estadoInvitacion(inv, now), 'ACEPTADA');
  });

  it('REVOCADA tiene precedencia sobre EXPIRADA', () => {
    const inv = { aceptadaAt: null, revocadaAt: now, expiresAt: pasado };
    assert.equal(estadoInvitacion(inv, now), 'REVOCADA');
  });

  it('EXPIRADA cuando expiresAt <= now', () => {
    const inv = { aceptadaAt: null, revocadaAt: null, expiresAt: now };
    assert.equal(estadoInvitacion(inv, now), 'EXPIRADA');
  });

  it('EXPIRADA cuando expiresAt < now', () => {
    const inv = { aceptadaAt: null, revocadaAt: null, expiresAt: pasado };
    assert.equal(estadoInvitacion(inv, now), 'EXPIRADA');
  });

  it('PENDIENTE cuando nada aplica y expiresAt está en el futuro', () => {
    const inv = { aceptadaAt: null, revocadaAt: null, expiresAt: futuro };
    assert.equal(estadoInvitacion(inv, now), 'PENDIENTE');
  });
});

describe('ROL_LABELS', () => {
  it('mapea los tres roles', () => {
    assert.deepEqual(ROL_LABELS, {
      SOCIO: 'Socio',
      LIDER: 'Líder',
      ADMIN: 'Administrador',
    });
  });
});

describe('puedeCambiarRol', () => {
  it('devuelve false cuando requester y target son el mismo id', () => {
    assert.equal(puedeCambiarRol('u1', 'u1'), false);
  });

  it('devuelve true cuando requester y target son distintos', () => {
    assert.equal(puedeCambiarRol('u1', 'u2'), true);
  });
});
