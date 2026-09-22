import { parseArgs } from 'node:util';
import { emailField, nameField } from '../lib/auth-fields.js';
import { MEMBRESIAS_PROPIAS } from '../lib/membresias.js';

// Puro (sin Prisma, sin I/O): parsea y valida los argumentos de línea de
// comandos de tenant.ts. Mismo estilo que create-user-args.ts.

const COMANDOS = ['create', 'list', 'suspend', 'activate', 'invite'] as const;
type Comando = (typeof COMANDOS)[number];

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Los slugs "iso-test-*" los crea y purga la suite de aislamiento
// (test:isolation, ver scripts/test-isolation.ts): un club real con ese
// prefijo desaparecería en la próxima corrida de la suite. Los demás son
// nombres que ya identifican otra cosa en la infraestructura (la propia
// plataforma, subdominios técnicos, la marca del proveedor de correo).
const PREFIJOS_RESERVADOS = ['iso-test-'];
const SLUGS_RESERVADOS = ['platform', 'plataforma', 'admin', 'api', 'www', 'app', 'riala'];

export const USAGE = `Uso: tenant <comando> [flags]

Comandos:
  create    --slug <slug> --name "<nombre>" [--short-name "<nombre corto>"] --membresia <${MEMBRESIAS_PROPIAS.join('|')}> --alert-email <email> --contact-name "<nombre>" --contact-email <email> --admin-email <email>
            Crea un club nuevo (organización + categorías por defecto + declaración jurada vigente) e invita a su primer ADMIN.
  list
            Lista todos los clubes.
  suspend   --slug <slug>
            Suspende un club: bloquea el login y toda request autenticada (403). Las alertas de seguridad de sus salidas abiertas siguen enviándose.
  activate  --slug <slug>
            Reactiva un club suspendido.
  invite    --slug <slug> --admin-email <email>
            Reemite la invitación de plataforma del primer ADMIN de un club existente (la anterior expiró o el email era incorrecto).`;

export interface CreateTenantArgs {
  command: 'create';
  slug: string;
  name: string;
  shortName: string | null;
  membresia: string;
  alertEmail: string;
  contactName: string;
  contactEmail: string;
  adminEmail: string;
}

export interface ListTenantArgs {
  command: 'list';
}

export interface SuspendTenantArgs {
  command: 'suspend';
  slug: string;
}

export interface ActivateTenantArgs {
  command: 'activate';
  slug: string;
}

export interface InviteTenantArgs {
  command: 'invite';
  slug: string;
  adminEmail: string;
}

export type TenantArgs = CreateTenantArgs | ListTenantArgs | SuspendTenantArgs | ActivateTenantArgs | InviteTenantArgs;

export type ParseTenantArgsResult = { success: true; data: TenantArgs } | { success: false; errors: string[] };

type CampoResult = { value: string } | { error: string };

function validarSlug(raw: string | undefined, campo = '--slug'): CampoResult {
  if (raw === undefined) return { error: `${campo} es requerido` };
  const slug = raw.trim().toLowerCase();
  if (slug === '') return { error: `${campo} no puede estar vacío` };
  if (slug.length < 2 || slug.length > 40 || !SLUG_REGEX.test(slug)) {
    return {
      error: `${campo} solo admite minúsculas, números y guiones simples (2 a 40 caracteres, sin guion al inicio/fin ni dobles)`,
    };
  }
  if (PREFIJOS_RESERVADOS.some((prefijo) => slug.startsWith(prefijo))) {
    return {
      error: `${campo}="${slug}" está reservado: los slugs "iso-test-*" los crea y purga la suite de aislamiento (npm run test:isolation)`,
    };
  }
  if (SLUGS_RESERVADOS.includes(slug)) {
    return { error: `${campo}="${slug}" está reservado y no puede usarse para un club` };
  }
  return { value: slug };
}

function validarEmail(raw: string | undefined, campo: string): CampoResult {
  if (raw === undefined) return { error: `${campo} es requerido` };
  const parsed = emailField.safeParse(raw);
  if (!parsed.success) return { error: `${campo}: ${parsed.error.issues[0]?.message ?? 'inválido'}` };
  return { value: parsed.data.toLowerCase() };
}

function validarNombre(raw: string | undefined, campo: string): CampoResult {
  if (raw === undefined) return { error: `${campo} es requerido` };
  const parsed = nameField.safeParse(raw);
  if (!parsed.success) return { error: `${campo}: ${parsed.error.issues[0]?.message ?? 'inválido'}` };
  return { value: parsed.data };
}

function parseListArgs(argv: string[]): ParseTenantArgsResult {
  try {
    parseArgs({ args: argv, options: {}, strict: true, allowPositionals: false });
  } catch {
    return { success: false, errors: [`"list" no admite flags.\n\n${USAGE}`] };
  }
  return { success: true, data: { command: 'list' } };
}

function parseCreateArgs(argv: string[]): ParseTenantArgsResult {
  let rawValues: {
    slug?: string;
    name?: string;
    'short-name'?: string;
    membresia?: string;
    'alert-email'?: string;
    'contact-name'?: string;
    'contact-email'?: string;
    'admin-email'?: string;
  };
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        slug: { type: 'string' },
        name: { type: 'string' },
        'short-name': { type: 'string' },
        membresia: { type: 'string' },
        'alert-email': { type: 'string' },
        'contact-name': { type: 'string' },
        'contact-email': { type: 'string' },
        'admin-email': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    });
    rawValues = parsed.values;
  } catch {
    return { success: false, errors: [`Flags inválidos para "create".\n\n${USAGE}`] };
  }

  const errors: string[] = [];
  let slug: string | undefined;
  let name: string | undefined;
  let contactName: string | undefined;
  let alertEmail: string | undefined;
  let contactEmail: string | undefined;
  let adminEmail: string | undefined;

  const slugResult = validarSlug(rawValues.slug);
  if ('error' in slugResult) errors.push(slugResult.error);
  else slug = slugResult.value;

  const nameResult = validarNombre(rawValues.name, '--name');
  if ('error' in nameResult) errors.push(nameResult.error);
  else name = nameResult.value;

  let shortName: string | null = null;
  if (rawValues['short-name'] !== undefined) {
    const trimmed = rawValues['short-name'].trim();
    shortName = trimmed === '' ? null : trimmed;
  }

  if (rawValues.membresia === undefined) {
    errors.push('--membresia es requerido');
  } else if (!(MEMBRESIAS_PROPIAS as readonly string[]).includes(rawValues.membresia)) {
    errors.push(`--membresia debe ser una de: ${MEMBRESIAS_PROPIAS.join(', ')}`);
  }

  const alertEmailResult = validarEmail(rawValues['alert-email'], '--alert-email');
  if ('error' in alertEmailResult) errors.push(alertEmailResult.error);
  else alertEmail = alertEmailResult.value;

  const contactNameResult = validarNombre(rawValues['contact-name'], '--contact-name');
  if ('error' in contactNameResult) errors.push(contactNameResult.error);
  else contactName = contactNameResult.value;

  const contactEmailResult = validarEmail(rawValues['contact-email'], '--contact-email');
  if ('error' in contactEmailResult) errors.push(contactEmailResult.error);
  else contactEmail = contactEmailResult.value;

  const adminEmailResult = validarEmail(rawValues['admin-email'], '--admin-email');
  if ('error' in adminEmailResult) errors.push(adminEmailResult.error);
  else adminEmail = adminEmailResult.value;

  if (
    errors.length > 0 ||
    !slug ||
    !name ||
    rawValues.membresia === undefined ||
    !alertEmail ||
    !contactName ||
    !contactEmail ||
    !adminEmail
  ) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      command: 'create',
      slug,
      name,
      shortName,
      membresia: rawValues.membresia,
      alertEmail,
      contactName,
      contactEmail,
      adminEmail,
    },
  };
}

function parseSuspendActivateArgs(argv: string[], command: 'suspend' | 'activate'): ParseTenantArgsResult {
  let rawValues: { slug?: string };
  try {
    const parsed = parseArgs({
      args: argv,
      options: { slug: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    rawValues = parsed.values;
  } catch {
    return { success: false, errors: [`Flags inválidos para "${command}".\n\n${USAGE}`] };
  }

  const slugResult = validarSlug(rawValues.slug);
  if ('error' in slugResult) {
    return { success: false, errors: [slugResult.error] };
  }

  return { success: true, data: { command, slug: slugResult.value } };
}

function parseInviteArgs(argv: string[]): ParseTenantArgsResult {
  let rawValues: { slug?: string; 'admin-email'?: string };
  try {
    const parsed = parseArgs({
      args: argv,
      options: { slug: { type: 'string' }, 'admin-email': { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    rawValues = parsed.values;
  } catch {
    return { success: false, errors: [`Flags inválidos para "invite".\n\n${USAGE}`] };
  }

  const errors: string[] = [];
  let slug: string | undefined;
  let adminEmail: string | undefined;

  const slugResult = validarSlug(rawValues.slug);
  if ('error' in slugResult) errors.push(slugResult.error);
  else slug = slugResult.value;

  const adminEmailResult = validarEmail(rawValues['admin-email'], '--admin-email');
  if ('error' in adminEmailResult) errors.push(adminEmailResult.error);
  else adminEmail = adminEmailResult.value;

  if (errors.length > 0 || !slug || !adminEmail) {
    return { success: false, errors };
  }

  return { success: true, data: { command: 'invite', slug, adminEmail } };
}

export function parseTenantArgs(argv: string[]): ParseTenantArgsResult {
  const [comandoRaw, ...rest] = argv;
  if (comandoRaw === undefined || !(COMANDOS as readonly string[]).includes(comandoRaw)) {
    return { success: false, errors: [`Comando desconocido.\n\n${USAGE}`] };
  }
  const command = comandoRaw as Comando;

  switch (command) {
    case 'list':
      return parseListArgs(rest);
    case 'create':
      return parseCreateArgs(rest);
    case 'suspend':
      return parseSuspendActivateArgs(rest, 'suspend');
    case 'activate':
      return parseSuspendActivateArgs(rest, 'activate');
    case 'invite':
      return parseInviteArgs(rest);
  }
}
