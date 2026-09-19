import { google } from 'googleapis';
import { getOAuth2Client } from './google-credentials.js';

// Sin memorizar el cliente Gmail a propósito: construirlo es barato y lo caro
// (el access token) ya lo cachea el OAuth2Client compartido. Así, cuando un
// admin pega un token nuevo en el panel, basta con invalidar esa única caché.
async function getGmailClient(): Promise<ReturnType<typeof google.gmail>> {
  return google.gmail({ version: 'v1', auth: await getOAuth2Client() });
}

function buildRawEmail(to: string, subject: string, html: string): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const message = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ].join('\r\n');
  return Buffer.from(message).toString('base64url');
}

// Devuelve el id del mensaje en Gmail (proveedorId de la cola de notificaciones)
export async function sendEmail(to: string, subject: string, htmlBody: string): Promise<string | undefined> {
  const gmail = await getGmailClient();
  const raw = buildRawEmail(to, subject, htmlBody);
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return res.data.id ?? undefined;
}
