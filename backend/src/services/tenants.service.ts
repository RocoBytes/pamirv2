// Lógica de negocio del alta y administración de clubes (tenants), separada de
// Prisma y de la CLI: recibe un repositorio inyectado (ver
// tenants.repo.prisma.ts para la implementación real) para poder probarse con
// un repositorio en memoria — mismo patrón que invitaciones.service.ts.
import { z } from 'zod';
import type { OrganizationStatus } from '../generated/prisma/client.js';
import { emailField, nameField } from '../lib/auth-fields.js';
import { MEMBRESIAS_PROPIAS, type MembresiaPropia } from '../lib/membresias.js';
import { DEFAULT_CATEGORIAS_EVENTO, buildDefaultDeclaracion } from '../lib/tenant-defaults.js';
import type { ServiceResult, CrearInvitacionBody } from './invitaciones.service.js';

// ─── Tipos del repositorio ──────────────────────────────────────────────────────

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  status: OrganizationStatus;
  membresiaPropia: string;
  createdAt: Date;
}

export interface CrearClubData {
  slug: string;
  name: string;
  shortName: string | null;
  membresiaPropia: string;
  alertEmail: string;
  contactName: string;
  contactEmail: string;
}

export interface CrearClubTransaccionResult {
  organization: OrganizationRow;
  categoriasCreadas: number;
}

export interface ClubListRow {
  slug: string;
  name: string;
  status: OrganizationStatus;
  membresiaPropia: string;
  userCount: number;
  pendingInvitationCount: number;
  createdAt: Date;
}

export interface TenantsRepo {
  findOrganizationBySlug(slug: string): Promise<OrganizationRow | null>;
  // La base de datos NO impone unicidad sobre membresiaPropia (no es una
  // columna @unique en el esquema): la regla "un código de membresía = un
  // club" es de negocio, no de esquema, así que se comprueba acá antes de
  // escribir — ver el comentario sobre MEMBRESIAS_PROPIAS en lib/membresias.ts.
  findOrganizationByMembresia(membresiaPropia: string): Promise<OrganizationRow | null>;
  // Crea Organization + las categorías por defecto + la declaración jurada
  // vigente en UNA sola transacción: un club nunca debe quedar a medio crear
  // (con categorías pero sin declaración, o viceversa).
  crearClubTransaccion(
    data: CrearClubData,
    categorias: typeof DEFAULT_CATEGORIAS_EVENTO,
    declaracion: ReturnType<typeof buildDefaultDeclaracion>,
  ): Promise<CrearClubTransaccionResult>;
  listOrganizations(): Promise<ClubListRow[]>;
  updateOrganizationStatus(id: string, status: OrganizationStatus): Promise<OrganizationRow>;
}

// ─── Dependencias inyectadas ────────────────────────────────────────────────────

export interface TenantsDeps {
  repo: TenantsRepo;
  // Ya envuelta por quien arma las deps reales (ver scripts/tenant.ts) en el
  // contexto del club correspondiente (runWithOrganization): este servicio no
  // conoce tenant-context.ts ni invitaciones.service.ts en tiempo de
  // ejecución, solo su forma de resultado.
  crearInvitacionAdmin: (organizationId: string, email: string) => Promise<ServiceResult<CrearInvitacionBody>>;
  // Ninguna operación lo usa todavía (createdAt lo pone la base de datos);
  // se inyecta igual, por el mismo motivo que en InvitacionesDeps: ninguna
  // operación de este servicio debe poder leer el reloj del sistema
  // directamente, para que una regla futura que sí lo necesite se pueda
  // probar de forma determinista.
  now: () => Date;
}

// ─── Resultado discriminado (mismo patrón que invitaciones.service.ts) ────────

export type TenantResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; error: string };

// ─── Validación ─────────────────────────────────────────────────────────────────

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MENSAJE_SLUG_FORMATO =
  'El slug solo admite minúsculas, números y guiones simples (2 a 40 caracteres, sin guion al inicio/fin ni dobles)';

const slugLengthField = z.string().trim().min(2, MENSAJE_SLUG_FORMATO).max(40, MENSAJE_SLUG_FORMATO);
// El nombre visible del club: más permisivo que nameField (pensado para el
// nombre de una persona) porque el nombre de un club suele ser más largo.
const orgNameField = z
  .string()
  .trim()
  .min(2, 'El nombre del club debe tener entre 2 y 120 caracteres')
  .max(120, 'El nombre del club debe tener entre 2 y 120 caracteres');
const shortNameField = z
  .string()
  .trim()
  .min(1, 'El nombre corto no puede estar vacío')
  .max(60, 'El nombre corto no puede superar los 60 caracteres');
const membresiaPropiaField = z.enum(MEMBRESIAS_PROPIAS);

const MENSAJE_MEMBRESIA_INVALIDA = `La membresía propia debe ser una de: ${MEMBRESIAS_PROPIAS.join(', ')}`;

interface CamposValidados {
  slug: string;
  name: string;
  shortName: string | null;
  membresiaPropia: MembresiaPropia;
  alertEmail: string;
  contactName: string;
  contactEmail: string;
  adminEmail: string;
}

export interface CrearClubInput {
  slug: unknown;
  name: unknown;
  shortName?: unknown;
  membresiaPropia: unknown;
  alertEmail: unknown;
  contactName: unknown;
  contactEmail: unknown;
  adminEmail: unknown;
}

// Valida secuencialmente y corta en el primer error (mismo estilo que
// invitaciones.service.ts): más simple que agregar todos los errores, y basta
// para un CLI que solo puede corregir un flag a la vez.
function validarCamposClub(input: CrearClubInput): { error: string } | { data: CamposValidados } {
  const slugParsed = slugLengthField.safeParse(input.slug);
  if (!slugParsed.success) return { error: slugParsed.error.issues[0]?.message ?? MENSAJE_SLUG_FORMATO };
  const slug = slugParsed.data.toLowerCase();
  if (!SLUG_REGEX.test(slug)) return { error: MENSAJE_SLUG_FORMATO };

  const nameParsed = orgNameField.safeParse(input.name);
  if (!nameParsed.success) return { error: nameParsed.error.issues[0]?.message ?? 'Nombre inválido' };

  let shortName: string | null = null;
  if (input.shortName !== undefined && input.shortName !== null && input.shortName !== '') {
    const shortNameParsed = shortNameField.safeParse(input.shortName);
    if (!shortNameParsed.success) {
      return { error: shortNameParsed.error.issues[0]?.message ?? 'Nombre corto inválido' };
    }
    shortName = shortNameParsed.data;
  }

  const membresiaParsed = membresiaPropiaField.safeParse(input.membresiaPropia);
  if (!membresiaParsed.success) return { error: MENSAJE_MEMBRESIA_INVALIDA };

  const alertEmailParsed = emailField.safeParse(input.alertEmail);
  if (!alertEmailParsed.success) {
    return { error: `Email de alerta: ${alertEmailParsed.error.issues[0]?.message ?? 'inválido'}` };
  }

  const contactNameParsed = nameField.safeParse(input.contactName);
  if (!contactNameParsed.success) {
    return { error: `Nombre de contacto: ${contactNameParsed.error.issues[0]?.message ?? 'inválido'}` };
  }

  const contactEmailParsed = emailField.safeParse(input.contactEmail);
  if (!contactEmailParsed.success) {
    return { error: `Email de contacto: ${contactEmailParsed.error.issues[0]?.message ?? 'inválido'}` };
  }

  const adminEmailParsed = emailField.safeParse(input.adminEmail);
  if (!adminEmailParsed.success) {
    return { error: `Email del administrador: ${adminEmailParsed.error.issues[0]?.message ?? 'inválido'}` };
  }

  return {
    data: {
      slug,
      name: nameParsed.data,
      shortName,
      membresiaPropia: membresiaParsed.data,
      alertEmail: alertEmailParsed.data.toLowerCase(),
      contactName: contactNameParsed.data,
      contactEmail: contactEmailParsed.data.toLowerCase(),
      adminEmail: adminEmailParsed.data.toLowerCase(),
    },
  };
}

// ─── crearClub ──────────────────────────────────────────────────────────────────

export interface CrearClubBody {
  organization: OrganizationRow;
  categoriasCreadas: number;
  declaracion: { version: string; titulo: string };
  invitacion:
    | { emitida: true; inviteUrl: string; emailEnviado: boolean }
    | { emitida: false; error: string; comandoRecuperacion: string };
}

export async function crearClub(deps: TenantsDeps, input: CrearClubInput): Promise<TenantResult<CrearClubBody>> {
  const validado = validarCamposClub(input);
  if ('error' in validado) {
    return { ok: false, status: 400, error: validado.error };
  }
  const { slug, name, shortName, membresiaPropia, alertEmail, contactName, contactEmail, adminEmail } =
    validado.data;

  const existingSlug = await deps.repo.findOrganizationBySlug(slug);
  if (existingSlug) {
    return { ok: false, status: 409, error: `Ya existe un club con slug="${slug}"` };
  }

  const existingMembresia = await deps.repo.findOrganizationByMembresia(membresiaPropia);
  if (existingMembresia) {
    return {
      ok: false,
      status: 409,
      error:
        `La membresía "${membresiaPropia}" ya la usa el club "${existingMembresia.slug}" ` +
        '(Organization.membresiaPropia debe ser única por club, aunque la base de datos no lo exija).',
    };
  }

  const declaracion = buildDefaultDeclaracion({ name });

  // Atómico: si la creación de una categoría o de la declaración fallara a
  // mitad de camino, la transacción del repositorio revierte TODO, incluida
  // la fila de Organization — nunca queda un club a medio crear.
  const { organization, categoriasCreadas } = await deps.repo.crearClubTransaccion(
    { slug, name, shortName, membresiaPropia, alertEmail, contactName, contactEmail },
    DEFAULT_CATEGORIAS_EVENTO,
    declaracion,
  );

  // La invitación corre DESPUÉS de que la transacción anterior ya confirmó:
  // si esto falla (correo inválido para crearInvitacionPlataforma, error de
  // envío, etc.) el club se queda creado — nunca se revierte un club ya
  // comprometido — y el resultado lo dice explícitamente con el comando para
  // reintentar solo la invitación.
  const invitacionResult = await deps.crearInvitacionAdmin(organization.id, adminEmail);

  return {
    ok: true,
    status: 201,
    body: {
      organization,
      categoriasCreadas,
      declaracion: { version: declaracion.version, titulo: declaracion.titulo },
      invitacion: invitacionResult.ok
        ? { emitida: true, inviteUrl: invitacionResult.body.inviteUrl, emailEnviado: invitacionResult.body.emailEnviado }
        : {
            emitida: false,
            error: invitacionResult.error,
            comandoRecuperacion: `npm run tenant:invite -- --slug ${slug} --admin-email <email>`,
          },
    },
  };
}

// ─── listarClubes ───────────────────────────────────────────────────────────────

export async function listarClubes(deps: TenantsDeps): Promise<ClubListRow[]> {
  return deps.repo.listOrganizations();
}

// ─── cambiarEstadoClub ──────────────────────────────────────────────────────────

export interface CambiarEstadoClubBody {
  slug: string;
  estadoAnterior: OrganizationStatus;
  estadoNuevo: OrganizationStatus;
  sinCambios: boolean;
}

export async function cambiarEstadoClub(
  deps: TenantsDeps,
  slug: string,
  nuevoEstado: OrganizationStatus,
): Promise<TenantResult<CambiarEstadoClubBody>> {
  const organization = await deps.repo.findOrganizationBySlug(slug);
  if (!organization) {
    return { ok: false, status: 404, error: `No existe ningún club con slug="${slug}"` };
  }

  if (organization.status === nuevoEstado) {
    return {
      ok: true,
      status: 200,
      body: { slug, estadoAnterior: organization.status, estadoNuevo: nuevoEstado, sinCambios: true },
    };
  }

  const actualizado = await deps.repo.updateOrganizationStatus(organization.id, nuevoEstado);
  return {
    ok: true,
    status: 200,
    body: { slug, estadoAnterior: organization.status, estadoNuevo: actualizado.status, sinCambios: false },
  };
}

// ─── invitarAdminClub ───────────────────────────────────────────────────────────
// Reemite una invitación de plataforma para un club ya existente: hace falta
// cuando la primera invitación expiró (7 días) o la dirección era incorrecta
// — sin esto, el operador tendría que tocar la base de datos a mano.

export interface InvitarAdminClubBody {
  slug: string;
  inviteUrl: string;
  emailEnviado: boolean;
}

export async function invitarAdminClub(
  deps: TenantsDeps,
  slug: string,
  adminEmail: unknown,
): Promise<TenantResult<InvitarAdminClubBody>> {
  const organization = await deps.repo.findOrganizationBySlug(slug);
  if (!organization) {
    return { ok: false, status: 404, error: `No existe ningún club con slug="${slug}"` };
  }

  const emailParsed = emailField.safeParse(adminEmail);
  if (!emailParsed.success) {
    return { ok: false, status: 400, error: emailParsed.error.issues[0]?.message ?? 'Email inválido' };
  }

  const resultado = await deps.crearInvitacionAdmin(organization.id, emailParsed.data.toLowerCase());
  if (!resultado.ok) {
    return { ok: false, status: resultado.status, error: resultado.error };
  }

  return {
    ok: true,
    status: 201,
    body: { slug, inviteUrl: resultado.body.inviteUrl, emailEnviado: resultado.body.emailEnviado },
  };
}
