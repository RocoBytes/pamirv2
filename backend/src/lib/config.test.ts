import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMailFrom, resolveFrontendUrl, resolveMailAccounts, mailAccountEnvVarNames } from './config.js';

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

describe('resolveMailAccounts', () => {
  it('sin ninguna variable, la cuenta de cada tipo queda sin usuario ni clave', () => {
    const result = resolveMailAccounts({});
    assert.equal(result.notificacion.user, '');
    assert.equal(result.notificacion.pass, '');
    assert.equal(result.alerta.user, '');
    assert.equal(result.alerta.pass, '');
    // La dirección se resuelve igual que en resolveMailFrom, aun sin credenciales.
    assert.equal(result.notificacion.address, 'notificaciones@riala.cl');
  });

  it('usa el par propio del tipo cuando está completo', () => {
    const result = resolveMailAccounts({
      SMTP_USER_ALERTAS: 'alertas@riala.cl',
      SMTP_PASS_ALERTAS: 'clave-alertas',
    });
    assert.equal(result.alerta.user, 'alertas@riala.cl');
    assert.equal(result.alerta.pass, 'clave-alertas');
  });

  it('sin el par propio, cae al par global', () => {
    const result = resolveMailAccounts({ SMTP_USER: 'global@riala.cl', SMTP_PASS: 'clave-global' });
    assert.equal(result.notificacion.user, 'global@riala.cl');
    assert.equal(result.notificacion.pass, 'clave-global');
    assert.equal(result.alerta.user, 'global@riala.cl');
    assert.equal(result.alerta.pass, 'clave-global');
  });

  it('el par propio de un tipo no afecta al otro tipo', () => {
    const result = resolveMailAccounts({
      SMTP_USER_ALERTAS: 'alertas@riala.cl',
      SMTP_PASS_ALERTAS: 'clave-alertas',
      SMTP_USER: 'global@riala.cl',
      SMTP_PASS: 'clave-global',
    });
    assert.equal(result.alerta.user, 'alertas@riala.cl');
    assert.equal(result.alerta.pass, 'clave-alertas');
    assert.equal(result.notificacion.user, 'global@riala.cl');
    assert.equal(result.notificacion.pass, 'clave-global');
  });

  it('un valor en blanco en el par propio cuenta como ausente y cae al global', () => {
    const result = resolveMailAccounts({
      SMTP_USER_ALERTAS: '   ',
      SMTP_PASS_ALERTAS: '   ',
      SMTP_USER: 'global@riala.cl',
      SMTP_PASS: 'clave-global',
    });
    assert.equal(result.alerta.user, 'global@riala.cl');
    assert.equal(result.alerta.pass, 'clave-global');
  });

  it('usuario propio sin clave propia lanza nombrando ambas variables', () => {
    assert.throws(
      () => resolveMailAccounts({ SMTP_USER_ALERTAS: 'alertas@riala.cl' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /SMTP_USER_ALERTAS/);
        assert.match(err.message, /SMTP_PASS_ALERTAS/);
        return true;
      },
    );
  });

  it('clave propia sin usuario propio lanza nombrando ambas variables', () => {
    assert.throws(
      () => resolveMailAccounts({ SMTP_PASS_NOTIFICACIONES: 'clave-notificaciones' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /SMTP_USER_NOTIFICACIONES/);
        assert.match(err.message, /SMTP_PASS_NOTIFICACIONES/);
        return true;
      },
    );
  });

  it('un par global a medio configurar no lanza (solo se valida el par propio de cada tipo)', () => {
    // El par propio de cada tipo, completo o ausente, es lo único validado acá;
    // un global a medio configurar solo termina fallando más tarde, al resolver
    // el proveedor (ver get-email-provider.ts / assertSmtpEnv), donde SMTP_USER
    // o SMTP_PASS faltante ya se reporta nombrando la variable.
    assert.doesNotThrow(() => resolveMailAccounts({ SMTP_USER: 'global@riala.cl' }));
  });
});

describe('mailAccountEnvVarNames', () => {
  it('devuelve los nombres de variable exactos para "notificacion"', () => {
    assert.deepEqual(mailAccountEnvVarNames('notificacion'), {
      userEnvVar: 'SMTP_USER_NOTIFICACIONES',
      passEnvVar: 'SMTP_PASS_NOTIFICACIONES',
    });
  });

  it('devuelve los nombres de variable exactos para "alerta"', () => {
    assert.deepEqual(mailAccountEnvVarNames('alerta'), {
      userEnvVar: 'SMTP_USER_ALERTAS',
      passEnvVar: 'SMTP_PASS_ALERTAS',
    });
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
