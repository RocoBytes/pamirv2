import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoCodigoQr,
  cifrarTokenQr,
  descifrarTokenQr,
  QR_DURACIONES,
  QR_DURACION_DEFAULT,
  QR_MAX_USOS_DEFAULT,
  QR_MAX_USOS_TOPE,
} from './codigos-qr.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('estadoCodigoQr', () => {
  const base = { revocadoAt: null, expiresAt: new Date('2026-02-01T00:00:00.000Z'), usosRestantes: 5 };

  it('ACTIVO cuando no está revocado, no expiró y tiene usos', () => {
    assert.equal(estadoCodigoQr(base, NOW), 'ACTIVO');
  });

  it('REVOCADO tiene la máxima precedencia (aunque también esté expirado y agotado)', () => {
    assert.equal(
      estadoCodigoQr(
        { revocadoAt: NOW, expiresAt: new Date('2025-01-01T00:00:00.000Z'), usosRestantes: 0 },
        NOW,
      ),
      'REVOCADO',
    );
  });

  it('EXPIRADO tiene precedencia sobre AGOTADO', () => {
    assert.equal(
      estadoCodigoQr({ revocadoAt: null, expiresAt: new Date('2025-01-01T00:00:00.000Z'), usosRestantes: 0 }, NOW),
      'EXPIRADO',
    );
  });

  it('AGOTADO cuando usosRestantes <= 0 y sigue vigente', () => {
    assert.equal(estadoCodigoQr({ ...base, usosRestantes: 0 }, NOW), 'AGOTADO');
  });

  it('expiresAt === now cuenta como expirado (límite inclusivo)', () => {
    assert.equal(estadoCodigoQr({ ...base, expiresAt: NOW }, NOW), 'EXPIRADO');
  });
});

describe('QR_DURACIONES', () => {
  it('expone 2h/24h/7d en milisegundos', () => {
    assert.equal(QR_DURACIONES['2h'], 2 * 60 * 60 * 1000);
    assert.equal(QR_DURACIONES['24h'], 24 * 60 * 60 * 1000);
    assert.equal(QR_DURACIONES['7d'], 7 * 24 * 60 * 60 * 1000);
  });

  it('el default es 24h', () => {
    assert.equal(QR_DURACION_DEFAULT, '24h');
  });

  it('los topes de usos son 50 por defecto y 200 como máximo', () => {
    assert.equal(QR_MAX_USOS_DEFAULT, 50);
    assert.equal(QR_MAX_USOS_TOPE, 200);
  });
});

describe('cifrarTokenQr / descifrarTokenQr', () => {
  const SECRET = 'test-secret-not-used-for-real-auth-0000';

  it('roundtrip: descifra exactamente el token cifrado', () => {
    const token = 'un-token-de-invitacion-cualquiera';
    const payload = cifrarTokenQr(token, SECRET);
    assert.equal(descifrarTokenQr(payload, SECRET), token);
  });

  it('el payload cifrado nunca contiene el token en claro', () => {
    const token = 'token-secreto-12345';
    const payload = cifrarTokenQr(token, SECRET);
    assert.equal(payload.includes(token), false);
  });

  it('dos cifrados del mismo token producen payloads distintos (IV aleatorio)', () => {
    const token = 'mismo-token';
    assert.notEqual(cifrarTokenQr(token, SECRET), cifrarTokenQr(token, SECRET));
  });

  it('un payload alterado (tag manipulado) devuelve null, nunca lanza', () => {
    const payload = cifrarTokenQr('token', SECRET);
    const partes = payload.split('.');
    const tamperedTag = Buffer.from(partes[2] ?? '', 'base64url');
    tamperedTag[0] = (tamperedTag[0] ?? 0) ^ 0xff;
    const tampered = [partes[0], partes[1], tamperedTag.toString('base64url'), partes[3]].join('.');
    assert.equal(descifrarTokenQr(tampered, SECRET), null);
  });

  it('la clave equivocada devuelve null', () => {
    const payload = cifrarTokenQr('token', SECRET);
    assert.equal(descifrarTokenQr(payload, 'otro-secreto-completamente-distinto'), null);
  });

  it('un payload malformado devuelve null', () => {
    assert.equal(descifrarTokenQr('no-es-un-payload-valido', SECRET), null);
    assert.equal(descifrarTokenQr('v1.solo.tres.partes.de.mas', SECRET), null);
    assert.equal(descifrarTokenQr('v2.a.b.c', SECRET), null);
    assert.equal(descifrarTokenQr('', SECRET), null);
  });
});
