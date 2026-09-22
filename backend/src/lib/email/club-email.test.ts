import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildClubSender, sendClubEmail } from './club-email.js';
import { MAIL_FROM } from '../config.js';
import type { OrganizationSummary } from '../../types/index.js';
import type { EmailProvider } from './email-provider.js';

const org: OrganizationSummary = {
  id: 'org-1',
  slug: 'el-montanista',
  name: 'Club El Montañista',
  shortName: 'El Montañista',
  membresiaPropia: 'SOCIO_EL_MONTANISTA',
  alertEmail: 'alertas@elmontanista.cl',
  contactName: 'Secretaría',
  contactEmail: 'contacto@elmontanista.cl',
};

describe('buildClubSender', () => {
  it('arma el remitente con el nombre del club y la dirección dada', () => {
    const result = buildClubSender({ name: 'Club El Montañista' }, 'notificaciones@riala.cl');
    assert.equal(result.from, '"Club El Montañista" <notificaciones@riala.cl>');
  });

  it('elimina CR/LF y comillas del nombre para evitar inyección de cabeceras', () => {
    const result = buildClubSender(
      { name: 'Club\r\nBcc: atacante@evil.com "raro"' },
      'notificaciones@riala.cl',
    );
    assert.equal(result.from.includes('\r'), false);
    assert.equal(result.from.includes('\n'), false);
    assert.equal(result.from.includes('"raro"'), false);
    assert.equal(result.from, '"ClubBcc: atacante@evil.com raro" <notificaciones@riala.cl>');
  });

  it('elimina una barra invertida final para que no escape el cierre de la comilla', () => {
    const result = buildClubSender({ name: 'Club\\' }, 'notificaciones@riala.cl');
    assert.equal(result.from, '"Club" <notificaciones@riala.cl>');
  });

  it('colapsa espacios repetidos en el nombre', () => {
    const result = buildClubSender({ name: 'Club    con   espacios' }, 'notificaciones@riala.cl');
    assert.equal(result.from, '"Club con espacios" <notificaciones@riala.cl>');
  });

  it('si el nombre saneado queda vacío, devuelve solo la dirección', () => {
    const result = buildClubSender({ name: '\r\n"\\' }, 'notificaciones@riala.cl');
    assert.equal(result.from, 'notificaciones@riala.cl');
  });

  it('rechaza una dirección de remitente inválida', () => {
    assert.throws(() => buildClubSender({ name: 'Club' }, 'no es un email'), /[Dd]irección/);
  });
});

describe('sendClubEmail', () => {
  it('kind="notificacion" envía desde la dirección de notificaciones, con el nombre del club y el reply-to del contacto', async () => {
    const send = mock.fn(() => Promise.resolve({ id: 'sent-1' }));
    const provider: EmailProvider = { send };

    const id = await sendClubEmail(
      org,
      {
        to: 'socio@ejemplo.cl',
        subject: 'Asunto',
        html: '<p>hola</p>',
        kind: 'notificacion',
        idempotencyKey: 'clave-1',
      },
      provider,
    );

    assert.equal(id, 'sent-1');
    assert.equal(send.mock.calls.length, 1);
    const [message] = send.mock.calls[0]!.arguments;
    assert.equal(message.from, `"Club El Montañista" <${MAIL_FROM.notificacion}>`);
    assert.equal(message.replyTo, 'contacto@elmontanista.cl');
    assert.equal(message.to, 'socio@ejemplo.cl');
    assert.equal(message.subject, 'Asunto');
    assert.equal(message.html, '<p>hola</p>');
    assert.equal(message.idempotencyKey, 'clave-1');
  });

  it('kind="alerta" envía desde la dirección de alertas de seguridad', async () => {
    const send = mock.fn(() => Promise.resolve({ id: 'sent-alerta' }));
    const provider: EmailProvider = { send };

    await sendClubEmail(
      org,
      { to: 'socio@ejemplo.cl', subject: 'Alerta', html: '<p>alerta</p>', kind: 'alerta' },
      provider,
    );

    const [message] = send.mock.calls[0]!.arguments;
    assert.equal(message.from, `"Club El Montañista" <${MAIL_FROM.alerta}>`);
  });

  it('omite el reply-to cuando el contacto del club no es un email válido', async () => {
    const send = mock.fn(() => Promise.resolve({ id: 'sent-2' }));
    const provider: EmailProvider = { send };

    await sendClubEmail(
      { ...org, contactEmail: 'no-es-un-email' },
      { to: 'socio@ejemplo.cl', subject: 'Asunto', html: '<p>hola</p>', kind: 'notificacion' },
      provider,
    );

    const [message] = send.mock.calls[0]!.arguments;
    assert.equal(message.replyTo, undefined);
  });
});
