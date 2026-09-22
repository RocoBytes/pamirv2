// Lógica de negocio de las invitaciones, independiente de Prisma y de Express:
// recibe un repositorio inyectado (ver invitaciones.repo.prisma.ts para la
// implementación real) y devuelve un resultado discriminado que el controlador
// solo tiene que mapear a la respuesta HTTP. Así se puede probar con un
// repositorio en memoria (ver invitaciones.service.test.ts) — los Proxies del
// cliente de Prisma 7 no se pueden mockear con mock.method de node:test.
import type { RolUsuario } from '../generated/prisma/client.js';
import { emailField, nameField, passwordField } from '../lib/auth-fields.js';
import { canInvite, isAdmin } from '../lib/authz.js';
import {
  INVITE_TTL_MS,
  generateInviteToken,
  hashInviteToken,
  puedeInvitarRol,
  estadoInvitacion,
  ROL_LABELS,
  type EstadoInvitacion,
} from '../lib/invitaciones.js';

const INVITE_TTL_DIAS = Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000));

// ─── Tipos del repositorio ──────────────────────────────────────────────────────

export interface UsuarioBasico {
  id: string;
  email: string;
  name: string;
  rol: RolUsuario;
}

export interface InvitacionRow {
  id: string;
  organizationId: string;
  email: string;
  rol: RolUsuario;
  tokenHash: string;
  expiresAt: Date;
  invitadoPorId: string | null;
  aceptadaAt: Date | null;
  usuarioId: string | null;
  revocadaAt: Date | null;
  createdAt: Date;
}

export interface InvitacionConInvitador extends InvitacionRow {
  invitadoPorNombre: string | null;
}

export interface CrearInvitacionData {
  organizationId: string;
  email: string;
  rol: RolUsuario;
  tokenHash: string;
  expiresAt: Date;
  invitadoPorId: string;
}

export interface AceptarInvitacionInput {
  invitacionId: string;
  // Club de la invitación, nunca del body: el usuario nuevo siempre nace en
  // el mismo club que quien lo invitó.
  organizationId: string;
  email: string;
  name: string;
  passwordHash: string;
  rol: RolUsuario;
  now: Date;
}

export interface InvitacionesRepo {
  findUserByEmail(email: string): Promise<UsuarioBasico | null>;
  findUserById(id: string): Promise<Pick<UsuarioBasico, 'id' | 'name' | 'rol'> | null>;
  revokePendingForEmail(email: string, now: Date): Promise<void>;
  createInvitacion(data: CrearInvitacionData): Promise<InvitacionRow>;
  findByTokenHash(tokenHash: string): Promise<InvitacionRow | null>;
  findById(id: string): Promise<InvitacionRow | null>;
  list(filter: { invitadoPorId?: string }): Promise<InvitacionConInvitador[]>;
  markRevoked(id: string, now: Date): Promise<void>;
  // Marca la invitación como aceptada y crea el usuario en una sola transacción,
  // solo si la invitación sigue pendiente y vigente (update condicional con
  // affected rows === 1). null = la invitación ya no estaba disponible (carrera).
  acceptInvitacion(input: AceptarInvitacionInput): Promise<UsuarioBasico | null>;
}

// ─── Dependencias inyectadas ────────────────────────────────────────────────────

export interface SendInvitationEmailParams {
  to: string;
  invitadoPorNombre: string;
  rolLabel: string;
  inviteUrl: string;
  expiraEnDias: number;
}

export interface InvitacionesDeps {
  repo: InvitacionesRepo;
  // Envía el correo de invitación ya compuesto (HTML incluido); el servicio
  // nunca construye HTML — eso vive en lib/email-templates.ts, cableado por
  // el controlador.
  sendEmail: (params: SendInvitationEmailParams) => Promise<void>;
  hashPassword: (password: string) => Promise<string>;
  now: () => Date;
  frontendUrl: string;
}

// ─── Requester (subconjunto de AuthUser que necesita este módulo) ─────────────

export interface Requester {
  id: string;
  organizationId: string;
  name: string;
  rol: RolUsuario;
}

// ─── Resultado discriminado ─────────────────────────────────────────────────────

export type ServiceResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: string };

// ─── Vista pública de una invitación (nunca incluye tokenHash) ────────────────

export interface InvitacionPublica {
  id: string;
  email: string;
  rol: RolUsuario;
  estado: EstadoInvitacion;
  expiresAt: Date;
  createdAt: Date;
  aceptadaAt: Date | null;
  revocadaAt: Date | null;
  invitadoPor: { id: string; name: string } | null;
}

function toPublicView(
  inv: InvitacionRow,
  invitadoPor: { id: string; name: string } | null,
  now: Date,
): InvitacionPublica {
  return {
    id: inv.id,
    email: inv.email,
    rol: inv.rol,
    estado: estadoInvitacion(inv, now),
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    aceptadaAt: inv.aceptadaAt,
    revocadaAt: inv.revocadaAt,
    invitadoPor,
  };
}

async function invitadoPorPublico(
  deps: InvitacionesDeps,
  invitadoPorId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!invitadoPorId) return null;
  const user = await deps.repo.findUserById(invitadoPorId);
  return user ? { id: invitadoPorId, name: user.name } : null;
}

const MENSAJE_SIN_PERMISO = 'No tienes permiso para invitar';
const MENSAJE_ROL_NO_PERMITIDO = 'No puedes invitar con ese rol';
const MENSAJE_CUENTA_EXISTENTE = 'Ya existe una cuenta con ese correo';
const MENSAJE_NO_PENDIENTE = 'La invitación ya no está pendiente';
const MENSAJE_NO_ENCONTRADA = 'Invitación no encontrada';
const MENSAJE_TOKEN_INVALIDO = 'La invitación no es válida';
const MENSAJE_YA_UTILIZADA = 'Esta invitación ya fue utilizada. Inicia sesión.';
const MENSAJE_EXPIRADA = 'La invitación expiró. Pide a quien te invitó que la reenvíe.';
const MENSAJE_NO_VIGENTE = 'La invitación ya no está vigente';

// ─── crearInvitacion ────────────────────────────────────────────────────────────

export interface CrearInvitacionBody {
  invitacion: InvitacionPublica;
  inviteUrl: string;
  emailEnviado: boolean;
}

async function enviarCorreoInvitacion(
  deps: InvitacionesDeps,
  params: SendInvitationEmailParams,
): Promise<boolean> {
  try {
    await deps.sendEmail(params);
    return true;
  } catch {
    return false;
  }
}

export async function crearInvitacion(
  deps: InvitacionesDeps,
  requester: Requester,
  body: { email: unknown; rol?: unknown },
): Promise<ServiceResult<CrearInvitacionBody>> {
  if (!canInvite(requester)) {
    return { ok: false, status: 403, error: MENSAJE_SIN_PERMISO };
  }

  const emailParsed = emailField.safeParse(body.email);
  if (!emailParsed.success) {
    return { ok: false, status: 400, error: emailParsed.error.issues[0]?.message ?? 'Email inválido' };
  }
  const email = emailParsed.data.toLowerCase();

  const rolInput = typeof body.rol === 'string' ? body.rol : 'SOCIO';
  if (!puedeInvitarRol(requester.rol, rolInput)) {
    return { ok: false, status: 403, error: MENSAJE_ROL_NO_PERMITIDO };
  }
  // Seguro: puedeInvitarRol ya confirmó que rolInput pertenece a rolesInvitables(...),
  // que es un subconjunto de RolUsuario.
  const rol = rolInput as RolUsuario;

  const existing = await deps.repo.findUserByEmail(email);
  if (existing) {
    return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE };
  }

  const now = deps.now();
  await deps.repo.revokePendingForEmail(email, now);

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const invitacion = await deps.repo.createInvitacion({
    organizationId: requester.organizationId,
    email,
    rol,
    tokenHash,
    expiresAt,
    invitadoPorId: requester.id,
  });

  // Fragmento (#) a propósito: nunca llega al servidor ni a los logs del proxy.
  const inviteUrl = `${deps.frontendUrl}/#invite=${token}`;

  const emailEnviado = await enviarCorreoInvitacion(deps, {
    to: email,
    invitadoPorNombre: requester.name,
    rolLabel: ROL_LABELS[rol],
    inviteUrl,
    expiraEnDias: INVITE_TTL_DIAS,
  });

  return {
    ok: true,
    status: 201,
    body: {
      invitacion: toPublicView(invitacion, { id: requester.id, name: requester.name }, now),
      inviteUrl,
      emailEnviado,
    },
  };
}

// ─── listarInvitaciones ─────────────────────────────────────────────────────────

export async function listarInvitaciones(
  deps: InvitacionesDeps,
  requester: Requester,
): Promise<ServiceResult<{ invitaciones: InvitacionPublica[] }>> {
  if (!canInvite(requester)) {
    return { ok: false, status: 403, error: MENSAJE_SIN_PERMISO };
  }

  const now = deps.now();
  const rows = await deps.repo.list(isAdmin(requester) ? {} : { invitadoPorId: requester.id });
  const invitaciones = rows.map((row) =>
    toPublicView(
      row,
      row.invitadoPorId ? { id: row.invitadoPorId, name: row.invitadoPorNombre ?? '' } : null,
      now,
    ),
  );

  return { ok: true, status: 200, body: { invitaciones } };
}

// ─── Alcance compartido de revocar/reenviar ────────────────────────────────────

// ADMIN gestiona cualquier invitación; un LIDER solo las que él mismo envió.
// Ante falta de acceso se responde 404 (no 403) para no revelar existencia.
function tieneAccesoAInvitacion(requester: Requester, inv: InvitacionRow): boolean {
  return isAdmin(requester) || inv.invitadoPorId === requester.id;
}

async function cargarInvitacionPropia(
  deps: InvitacionesDeps,
  requester: Requester,
  id: string,
): Promise<InvitacionRow | { error: ServiceResult<never> }> {
  if (!canInvite(requester)) {
    return { error: { ok: false, status: 403, error: MENSAJE_SIN_PERMISO } };
  }

  const inv = await deps.repo.findById(id);
  if (!inv || !tieneAccesoAInvitacion(requester, inv)) {
    return { error: { ok: false, status: 404, error: MENSAJE_NO_ENCONTRADA } };
  }

  return inv;
}

// ─── revocarInvitacion ──────────────────────────────────────────────────────────

export async function revocarInvitacion(
  deps: InvitacionesDeps,
  requester: Requester,
  id: string,
): Promise<ServiceResult<{ invitacion: InvitacionPublica }>> {
  const inv = await cargarInvitacionPropia(deps, requester, id);
  if ('error' in inv) return inv.error;

  const now = deps.now();
  if (estadoInvitacion(inv, now) !== 'PENDIENTE') {
    return { ok: false, status: 409, error: MENSAJE_NO_PENDIENTE };
  }

  await deps.repo.markRevoked(id, now);

  const invitadoPor = await invitadoPorPublico(deps, inv.invitadoPorId);
  return {
    ok: true,
    status: 200,
    body: { invitacion: toPublicView({ ...inv, revocadaAt: now }, invitadoPor, now) },
  };
}

// ─── reenviarInvitacion ─────────────────────────────────────────────────────────

export async function reenviarInvitacion(
  deps: InvitacionesDeps,
  requester: Requester,
  id: string,
): Promise<ServiceResult<CrearInvitacionBody>> {
  const inv = await cargarInvitacionPropia(deps, requester, id);
  if ('error' in inv) return inv.error;

  const now = deps.now();
  const estado = estadoInvitacion(inv, now);
  if (estado !== 'PENDIENTE' && estado !== 'EXPIRADA') {
    return { ok: false, status: 409, error: MENSAJE_NO_PENDIENTE };
  }

  if (!puedeInvitarRol(requester.rol, inv.rol)) {
    return { ok: false, status: 403, error: MENSAJE_ROL_NO_PERMITIDO };
  }

  const existing = await deps.repo.findUserByEmail(inv.email);
  if (existing) {
    return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE };
  }

  await deps.repo.markRevoked(id, now);

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const nueva = await deps.repo.createInvitacion({
    organizationId: requester.organizationId,
    email: inv.email,
    rol: inv.rol,
    tokenHash,
    expiresAt,
    invitadoPorId: requester.id,
  });

  const inviteUrl = `${deps.frontendUrl}/#invite=${token}`;

  const emailEnviado = await enviarCorreoInvitacion(deps, {
    to: inv.email,
    invitadoPorNombre: requester.name,
    rolLabel: ROL_LABELS[inv.rol],
    inviteUrl,
    expiraEnDias: INVITE_TTL_DIAS,
  });

  return {
    ok: true,
    status: 201,
    body: {
      invitacion: toPublicView(nueva, { id: requester.id, name: requester.name }, now),
      inviteUrl,
      emailEnviado,
    },
  };
}

// ─── Validación de vigencia (compartida por consultar y aceptar) ──────────────

interface InvitacionVigente {
  vigente: true;
  inviter: Pick<UsuarioBasico, 'id' | 'name' | 'rol'>;
}

async function verificarVigencia(
  deps: InvitacionesDeps,
  inv: InvitacionRow,
  now: Date,
): Promise<InvitacionVigente | ServiceResult<never>> {
  const estado = estadoInvitacion(inv, now);
  if (estado === 'ACEPTADA') {
    return { ok: false, status: 410, error: MENSAJE_YA_UTILIZADA };
  }
  if (estado === 'EXPIRADA') {
    return { ok: false, status: 410, error: MENSAJE_EXPIRADA };
  }
  if (estado === 'REVOCADA') {
    return { ok: false, status: 410, error: MENSAJE_NO_VIGENTE };
  }

  // Una invitación solo vale lo que valga la autoridad vigente de quien la
  // envió: si ya no existe o fue degradado por debajo del rol otorgado, se
  // trata igual que una revocación.
  const inviter = inv.invitadoPorId ? await deps.repo.findUserById(inv.invitadoPorId) : null;
  if (!inviter || !puedeInvitarRol(inviter.rol, inv.rol)) {
    return { ok: false, status: 410, error: MENSAJE_NO_VIGENTE };
  }

  return { vigente: true, inviter };
}

// ─── consultarInvitacion ────────────────────────────────────────────────────────

export interface ConsultarInvitacionBody {
  email: string;
  rol: RolUsuario;
  rolLabel: string;
  invitadoPor: string;
}

export async function consultarInvitacion(
  deps: InvitacionesDeps,
  token: string,
): Promise<ServiceResult<ConsultarInvitacionBody>> {
  const inv = await deps.repo.findByTokenHash(hashInviteToken(token));
  if (!inv) {
    return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
  }

  const now = deps.now();
  const vigencia = await verificarVigencia(deps, inv, now);
  if (!('vigente' in vigencia)) return vigencia;

  return {
    ok: true,
    status: 200,
    body: { email: inv.email, rol: inv.rol, rolLabel: ROL_LABELS[inv.rol], invitadoPor: vigencia.inviter.name },
  };
}

// ─── aceptarInvitacion ──────────────────────────────────────────────────────────

export interface AceptarInvitacionBody {
  message: string;
  email: string;
}

export async function aceptarInvitacion(
  deps: InvitacionesDeps,
  token: string,
  body: { name: unknown; password: unknown },
): Promise<ServiceResult<AceptarInvitacionBody>> {
  const inv = await deps.repo.findByTokenHash(hashInviteToken(token));
  if (!inv) {
    return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
  }

  const now = deps.now();
  const vigencia = await verificarVigencia(deps, inv, now);
  if (!('vigente' in vigencia)) return vigencia;

  const nameParsed = nameField.safeParse(body.name);
  if (!nameParsed.success) {
    return { ok: false, status: 400, error: nameParsed.error.issues[0]?.message ?? 'Nombre inválido' };
  }
  const passwordParsed = passwordField.safeParse(body.password);
  if (!passwordParsed.success) {
    return { ok: false, status: 400, error: passwordParsed.error.issues[0]?.message ?? 'Contraseña inválida' };
  }

  // El email y el rol nunca se leen del body: solo importan los de la
  // invitación (lo que llegue en body.email/body.rol se ignora).
  const existing = await deps.repo.findUserByEmail(inv.email);
  if (existing) {
    return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE };
  }

  const passwordHash = await deps.hashPassword(passwordParsed.data);

  const user = await deps.repo.acceptInvitacion({
    invitacionId: inv.id,
    organizationId: inv.organizationId,
    email: inv.email,
    name: nameParsed.data,
    passwordHash,
    rol: inv.rol,
    now,
  });

  if (!user) {
    return { ok: false, status: 409, error: MENSAJE_NO_PENDIENTE };
  }

  return {
    ok: true,
    status: 201,
    body: { message: 'Cuenta creada. Ya puedes iniciar sesión.', email: user.email },
  };
}
