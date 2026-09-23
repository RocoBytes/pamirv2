import { emailField } from '../auth-fields.js';
import { MAIL_FROM, PLATFORM_SUPPORT_EMAIL } from '../config.js';
import type { EmailKind } from '../config.js';
import { getEmailProvider } from './get-email-provider.js';
import type { EmailProvider } from './email-provider.js';
import type { OrganizationSummary } from '../../types/index.js';

export interface ClubSenderOrg {
  name: string;
}

function sanitizeDisplayName(name: string): string {
  // Quita CR, LF, comillas y barras invertidas: una entrada como
  // `Club\r\nBcc: x` o `Club\` no debe poder inyectar una cabecera ni escapar
  // el cierre de la comilla del nombre visible.
  const sinCaracteresDeCabecera = name.replace(/[\r\n"\\]/g, '');

  // Quita el resto de los caracteres de control (0x00-0x1F y 0x7F): ninguno
  // pertenece a un nombre de club legítimo y podrían usarse para intentos de
  // inyección más exóticos que las cabeceras de arriba.
  const sinControles = Array.from(sinCaracteresDeCabecera)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('');

  return sinControles.replace(/\s+/g, ' ').trim();
}

// Pura: nunca toca red ni process.env. El nombre se sanea para que un dato de
// Organization (nombre libre, editable desde el panel) nunca pueda inyectar
// una cabecera en el correo saliente. La dirección remitente NO viene del
// club: la decide siempre `kind` a través de MAIL_FROM (ver lib/config.ts).
export function buildClubSender(org: ClubSenderOrg, address: string): { from: string } {
  const parsedAddress = emailField.safeParse(address);
  if (!parsedAddress.success) {
    throw new Error(`Dirección de remitente inválida: "${address}"`);
  }

  const displayName = sanitizeDisplayName(org.name);
  return { from: displayName ? `"${displayName}" <${parsedAddress.data}>` : parsedAddress.data };
}

export interface SendClubEmailParams {
  to: string;
  subject: string;
  html: string;
  // Sin valor por defecto a propósito: obliga a revisar, en cada sitio de
  // envío, si corresponde el remitente de notificaciones o el de alertas de
  // seguridad (ver MAIL_FROM en lib/config.ts).
  kind: EmailKind;
  idempotencyKey?: string;
}

// Envía un correo "como" el club: el nombre visible se deriva siempre de la
// organización, nunca del llamador; la dirección remitente depende solo de
// `kind`, nunca del club ni de la actividad. El reply-to es siempre el soporte
// de la plataforma (PLATFORM_SUPPORT_EMAIL), nunca el contacto del club: una
// respuesta a una notificación llega al equipo de RIALA. provider es
// inyectable para que los tests no dependan del entorno ni de la red.
export async function sendClubEmail(
  org: OrganizationSummary,
  params: SendClubEmailParams,
  provider: EmailProvider = getEmailProvider(params.kind),
): Promise<string | undefined> {
  const { from } = buildClubSender(org, MAIL_FROM[params.kind]);

  const result = await provider.send({
    from,
    replyTo: PLATFORM_SUPPORT_EMAIL,
    to: params.to,
    subject: params.subject,
    html: params.html,
    idempotencyKey: params.idempotencyKey,
  });
  return result.id;
}
