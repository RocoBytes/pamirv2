import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMailFrom, resolveFrontendUrl } from './config.js';

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

describe('resolveFrontendUrl', () => {
  it('sin la variable definida, usa el default de desarrollo', () => {
    assert.equal(resolveFrontendUrl({}), 'http://localhost:5173');
  });

  it('una variable en blanco cae al default (no un link sin host)', () => {
    assert.equal(resolveFrontendUrl({ FRONTEND_URL: '' }), 'http://localhost:5173');
  });

  it('una variable con solo espacios cae al default', () => {
    assert.equal(resolveFrontendUrl({ FRONTEND_URL: '   ' }), 'http://localhost:5173');
  });

  it('conserva una URL https válida', () => {
    assert.equal(resolveFrontendUrl({ FRONTEND_URL: 'https://andinoclubpamir.app' }), 'https://andinoclubpamir.app');
  });

  it('conserva una URL http válida (permitida para entornos internos/dev)', () => {
    assert.equal(resolveFrontendUrl({ FRONTEND_URL: 'http://192.168.1.10:5173' }), 'http://192.168.1.10:5173');
  });

  it('recorta una barra final', () => {
    assert.equal(resolveFrontendUrl({ FRONTEND_URL: 'https://andinoclubpamir.app/' }), 'https://andinoclubpamir.app');
  });

  it('recorta varias barras finales', () => {
    assert.equal(resolveFrontendUrl({ FRONTEND_URL: 'https://andinoclubpamir.app///' }), 'https://andinoclubpamir.app');
  });

  it('conserva un prefijo de ruta, recortando solo la barra final', () => {
    assert.equal(resolveFrontendUrl({ FRONTEND_URL: 'https://andinoclubpamir.app/app/' }), 'https://andinoclubpamir.app/app');
  });

  it('recorta los espacios alrededor del valor', () => {
    assert.equal(resolveFrontendUrl({ FRONTEND_URL: '  https://andinoclubpamir.app  ' }), 'https://andinoclubpamir.app');
  });

  it('rechaza un esquema que no sea http/https', () => {
    assert.throws(() => resolveFrontendUrl({ FRONTEND_URL: 'ftp://andinoclubpamir.app' }), /FRONTEND_URL/);
  });

  it('rechaza una ruta relativa (no es una URL absoluta)', () => {
    assert.throws(() => resolveFrontendUrl({ FRONTEND_URL: '/app' }), /FRONTEND_URL/);
  });

  it('rechaza un valor sin formato de URL', () => {
    assert.throws(() => resolveFrontendUrl({ FRONTEND_URL: 'esto no es una url' }), /FRONTEND_URL/);
  });

  it('el mensaje de error no incluye el valor recibido', () => {
    const valorSecreto = 'esto-no-deberia-aparecer-en-el-mensaje';
    try {
      resolveFrontendUrl({ FRONTEND_URL: valorSecreto });
      assert.fail('debía lanzar');
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      assert.ok(!mensaje.includes(valorSecreto));
    }
  });
});
