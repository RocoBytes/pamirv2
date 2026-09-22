import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMailFrom } from './config.js';

describe('resolveMailFrom', () => {
  it('usa los remitentes por defecto sin variables de entorno', () => {
    const result = resolveMailFrom({});
    assert.equal(result.notificacion, 'notificaciones@riala.cl');
    assert.equal(result.alerta, 'alertas@riala.cl');
  });

  it('usa el remitente definido por la variable de entorno', () => {
    const result = resolveMailFrom({ MAIL_FROM_NOTIFICACIONES: 'aviso@elclub.cl' });
    assert.equal(result.notificacion, 'aviso@elclub.cl');
  });

  it('un valor en blanco cae al remitente por defecto', () => {
    const result = resolveMailFrom({ MAIL_FROM_ALERTAS: '   ' });
    assert.equal(result.alerta, 'alertas@riala.cl');
  });

  it('una dirección inválida lanza nombrando la variable', () => {
    assert.throws(() => resolveMailFrom({ MAIL_FROM_ALERTAS: 'no-es-un-email' }), /MAIL_FROM_ALERTAS/);
  });

  it('una dirección con CR/LF es rechazada', () => {
    assert.throws(
      () => resolveMailFrom({ MAIL_FROM_NOTIFICACIONES: 'a@b.cl\r\nBcc: atacante@evil.com' }),
      /MAIL_FROM_NOTIFICACIONES/,
    );
  });
});
