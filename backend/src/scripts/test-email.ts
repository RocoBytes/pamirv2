// Ejercita el envío real de correo, un mensaje por cada EmailKind, contra el
// servidor SMTP real configurado en el entorno. No se ejecuta como parte de
// `npm test` (usa `npm run test:email -- <destino>`): abre una conexión SMTP
// real y entrega correo de verdad. Es el chequeo repetible de "cada dirección
// puede realmente enviar como sí misma" frente a un servidor que impone
// sender ownership (ver sección "Correo por club" en el README) — la
// motivación original fue un 553 real:
//   "Sender address rejected: not owned by user notificaciones@riala.cl"
//
// Nunca imprime la contraseña, el cuerpo HTML ni el diálogo SMTP: solo el
// remitente usado por cada tipo y, si falla, el error ya saneado por el
// proveedor (ver lib/email/smtp.provider.ts).
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { runAsPlatform } from '../lib/tenant-context.js';
import { sendClubEmail } from '../lib/email/club-email.js';
import { resolveEmailProviderName } from '../lib/email/get-email-provider.js';
import { MAIL_FROM } from '../lib/config.js';
import type { EmailKind } from '../lib/config.js';
import { emailField } from '../lib/auth-fields.js';

const KINDS = Object.keys(MAIL_FROM) as EmailKind[];

// riala es el club "de casa" (ver CLAUDE.md, el rebrand de la organización
// pamir); --slug permite apuntar a cualquier otro club sin tocar el script.
const DEFAULT_SLUG = 'riala';

interface CheckResult {
  kind: EmailKind;
  ok: boolean;
  detail?: string;
}

interface ParsedArgs {
  destino: string | undefined;
  slug: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let slug = DEFAULT_SLUG;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slug') {
      slug = argv[i + 1] ?? slug;
      i++;
      continue;
    }
    rest.push(argv[i]!);
  }
  return { destino: rest[0], slug };
}

async function main(): Promise<void> {
  const { destino, slug } = parseArgs(process.argv.slice(2));

  const destinoParsed = emailField.safeParse(destino);
  if (!destinoParsed.success) {
    console.error('[test-email] Uso: npm run test:email -- <destino@ejemplo.com> [--slug <slug-del-club>]');
    process.exitCode = 1;
    return;
  }
  const to = destinoParsed.data;

  // Este script solo tiene sentido contra el servidor SMTP real: si algún
  // tipo cae en "console" (sin SMTP_HOST configurado, o EMAIL_PROVIDER=console
  // fuera de producción) no habría nada que verificar para ese tipo.
  const noSmtp = KINDS.filter((kind) => resolveEmailProviderName(kind) !== 'smtp');
  if (noSmtp.length > 0) {
    console.error(
      `[test-email] Este script exige el proveedor "smtp" para cada tipo de correo. Resolvieron a "console": ` +
        `${noSmtp.join(', ')}. Define SMTP_HOST (y el resto de las variables SMTP_*) antes de correrlo.`,
    );
    process.exitCode = 1;
    return;
  }

  const organization = await runAsPlatform(() =>
    prisma.organization.findUniqueOrThrow({ where: { slug } }),
  );

  const results: CheckResult[] = [];
  for (const kind of KINDS) {
    try {
      await sendClubEmail(organization, {
        to,
        subject: `[test-email] Prueba de envío (${kind})`,
        html: `<p>Prueba manual de envío para el tipo "${kind}" — backend/src/scripts/test-email.ts.</p>`,
        kind,
      });
      results.push({ kind, ok: true });
      console.log(`  ✓ ${kind} — from=${MAIL_FROM[kind]}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ kind, ok: false, detail });
      console.log(`  ✗ ${kind} — from=${MAIL_FROM[kind]} — ${detail}`);
    }
  }

  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n[test-email] ${results.length - fails}/${results.length} envíos OK.`);
  process.exitCode = fails > 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error('[test-email] Error fatal:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
