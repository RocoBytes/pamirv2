import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildSmtpTransportOptions, createSmtpProvider } from './smtp.provider.js';
import type { SmtpTransport } from './smtp.provider.js';

describe('buildSmtpTransportOptions', () => {
  it('puerto 465 usa TLS implícito y no exige STARTTLS', () => {
    const options = buildSmtpTransportOptions({ host: 'smtp.riala.cl', port: 465, user: 'user', pass: 'pass' });
    assert.equal(options.host, 'smtp.riala.cl');
    assert.equal(options.port, 465);
    assert.equal(options.secure, true);
    assert.equal(options.requireTLS, undefined);
    assert.deepEqual(options.auth, { user: 'user', pass: 'pass' });
  });

  it('puerto 587 no usa TLS implícito pero exige STARTTLS', () => {
    const options = buildSmtpTransportOptions({ host: 'smtp.riala.cl', port: 587, user: 'user', pass: 'pass' });
    assert.equal(options.secure, false);
    assert.equal(options.requireTLS, true);
  });

  it('define timeouts para que un servidor colgado no bloquee el cron', () => {
    const options = buildSmtpTransportOptions({ host: 'smtp.riala.cl', port: 587, user: 'user', pass: 'pass' });
    assert.equal(options.connectionTimeout, 10_000);
    assert.equal(options.greetingTimeout, 10_000);
    assert.equal(options.socketTimeout, 20_000);
  });
});

describe('createSmtpProvider', () => {
  it('mapea los campos del mensaje al transporte y devuelve el messageId', async () => {
    const sendMail = mock.fn(() => Promise.resolve({ messageId: 'msg-1' }));
    const transport: SmtpTransport = { sendMail };
    const provider = createSmtpProvider({ host: 'smtp.riala.cl', port: 587, user: 'u', pass: 'p', transport });

    const result = await provider.send({
      from: '"Club" <notificaciones@riala.cl>',
      to: 'socio@ejemplo.cl',
      replyTo: 'contacto@club.cl',
      subject: 'Asunto',
      html: '<p>hola</p>',
    });

    assert.equal(result.id, 'msg-1');
    assert.equal(sendMail.mock.calls.length, 1);
    const [mail] = sendMail.mock.calls[0]!.arguments;
    assert.equal(mail.from, '"Club" <notificaciones@riala.cl>');
    assert.equal(mail.to, 'socio@ejemplo.cl');
    assert.equal(mail.replyTo, 'contacto@club.cl');
    assert.equal(mail.subject, 'Asunto');
    assert.equal(mail.html, '<p>hola</p>');
    assert.equal(mail.headers, undefined);
  });

  it('agrega la cabecera X-Entity-Ref-ID solo cuando hay idempotencyKey', async () => {
    const sendMail = mock.fn(() => Promise.resolve({ messageId: 'msg-2' }));
    const transport: SmtpTransport = { sendMail };
    const provider = createSmtpProvider({ host: 'smtp.riala.cl', port: 587, user: 'u', pass: 'p', transport });

    await provider.send({
      from: 'alertas@riala.cl',
      to: 'socio@ejemplo.cl',
      subject: 'Alerta',
      html: '<p>alerta</p>',
      idempotencyKey: 'alerta:salida-1',
    });

    const [mail] = sendMail.mock.calls[0]!.arguments;
    assert.equal(mail.headers?.['X-Entity-Ref-ID'], 'alerta:salida-1');
  });

  it('sanea la clave de idempotencia antes de usarla como cabecera', async () => {
    const sendMail = mock.fn(() => Promise.resolve({ messageId: 'msg-3' }));
    const transport: SmtpTransport = { sendMail };
    const provider = createSmtpProvider({ host: 'smtp.riala.cl', port: 587, user: 'u', pass: 'p', transport });

    await provider.send({
      from: 'alertas@riala.cl',
      to: 'socio@ejemplo.cl',
      subject: 'Alerta',
      html: '<p>alerta</p>',
      idempotencyKey: 'alerta:1\r\nX-Injected: true',
    });

    const [mail] = sendMail.mock.calls[0]!.arguments;
    assert.equal(mail.headers?.['X-Entity-Ref-ID'], 'alerta:1X-Injected: true');
  });

  it('sanea el error del transporte: nunca expone la contraseña, el usuario, el HTML ni el destinatario', async () => {
    const secretPassword = 'super-secreto-123';
    const secretUser = 'cuenta-smtp-riala';
    const leakyError = Object.assign(
      new Error(
        `535 Auth failed for user ${secretUser} with pass ${secretPassword}, rcpt socio@ejemplo.cl, body <p>datos de salud</p>`,
      ),
      {
        code: 'EAUTH',
        responseCode: 535,
        response: `535 rejected socio@ejemplo.cl user=${secretUser} pass=${secretPassword}`,
      },
    );
    const sendMail = mock.fn(() => Promise.reject(leakyError));
    const transport: SmtpTransport = { sendMail };
    const provider = createSmtpProvider({
      host: 'smtp.riala.cl',
      port: 587,
      user: secretUser,
      pass: secretPassword,
      transport,
    });

    await assert.rejects(
      () =>
        provider.send({
          from: 'alertas@riala.cl',
          to: 'socio@ejemplo.cl',
          subject: 'Alerta',
          html: '<p>datos de salud</p>',
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /EAUTH/);
        assert.match(err.message, /535/);
        assert.equal(err.message.includes(secretPassword), false);
        assert.equal(err.message.includes(secretUser), false);
        assert.equal(err.message.includes('socio@ejemplo.cl'), false);
        assert.equal(err.message.includes('datos de salud'), false);
        assert.equal('cause' in err, false);
        return true;
      },
    );
  });

  it('el mensaje de error genérico no incluye ningún detalle cuando el error no trae code ni responseCode', async () => {
    const sendMail = mock.fn(() => Promise.reject(new Error('boom con contraseña super-secreto-123')));
    const transport: SmtpTransport = { sendMail };
    const provider = createSmtpProvider({ host: 'smtp.riala.cl', port: 587, user: 'u', pass: 'p', transport });

    await assert.rejects(
      () => provider.send({ from: 'a@riala.cl', to: 'b@ejemplo.cl', subject: 's', html: 'h' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'El servidor SMTP rechazó el envío');
        return true;
      },
    );
  });
});
