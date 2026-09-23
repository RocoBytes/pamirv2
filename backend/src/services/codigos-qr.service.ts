// Lógica de negocio del QR reusable del club, independiente de Prisma y de
// Express — mismo patrón que invitaciones.service.ts: recibe un repositorio
// inyectado (ver codigos-qr.repo.prisma.ts) y devuelve un resultado
// discriminado que el controlador solo mapea a la respuesta HTTP. Se puede
// probar con un repositorio en memoria (ver codigos-qr.service.test.ts).
import type { RolUsuario } from '../generated/prisma/client.js';
import { emailField } from '../lib/auth-fields.js';
import { canInvite, isAdmin } from '../lib/authz.js';
import type { PublicOrganizationBrand } from '../lib/serializers/organization.js';
import { generateInviteToken, hashInviteToken, puedeInvitarRol, INVITE_TTL_MS, ROL_LABELS } from '../lib/invitaciones.js';
import {
  QR_DURACIONES,
  QR_DURACION_DEFAULT,
  QR_MAX_USOS_DEFAULT,
  QR_MAX_USOS_MIN,
  QR_MAX_USOS_TOPE,
  QR_ETIQUETA_MAX,
  ROL_QR,
  estadoCodigoQr,
  cifrarTokenQr,
  descifrarTokenQr,
  type QrDuracion,
  type EstadoCodigoQr,
} from '../lib/codigos-qr.js';
import type { UsuarioBasico, InvitacionRow, Requester, ServiceResult } from './invitaciones.service.js';

// ─── Tipos del repositorio ──────────────────────────────────────────────────────

export interface CodigoQrRow {
  id: string;
  organizationId: string;
  tokenHash: string;
  tokenCifrado: string;
  rol: RolUsuario;
  etiqueta: string | null;
  maxUsos: number;
  usosRestantes: number;
  expiresAt: Date;
  revocadoAt: Date | null;
  createdAt: Date;
  creadoPorId: string | null;
}

export interface CodigoQrConCreador extends CodigoQrRow {
  creadoPorNombre: string | null;
}

export interface CrearCodigoQrData {
  organizationId: string;
  tokenHash: string;
  tokenCifrado: string;
  etiqueta: string | null;
  maxUsos: number;
  usosRestantes: number;
  expiresAt: Date;
  creadoPorId: string;
}

// Un "uso" mintea exactamente una Invitacion normal; el decremento de
// usosRestantes y la creación de la invitación viven en una sola transacción
// (ver codigos-qr.repo.prisma.ts) — null significa que la carrera por el
// último uso se perdió (otra solicitud lo consumió primero).
export interface MintInvitacionInput {
  codigoQrId: string;
  organizationId: string;
  email: string;
  rol: RolUsuario;
  tokenHash: string;
  expiresAt: Date;
  invitadoPorId: string | null;
  now: Date;
}

export interface CodigosQrRepo {
  create(data: CrearCodigoQrData): Promise<CodigoQrRow>;
  list(filter: { creadoPorId?: string }): Promise<CodigoQrConCreador[]>;
  findById(id: string): Promise<CodigoQrRow | null>;
  findByTokenHash(tokenHash: string): Promise<CodigoQrRow | null>;
  markRevoked(id: string, now: Date): Promise<void>;
  findUserById(id: string): Promise<Pick<UsuarioBasico, 'id' | 'name' | 'rol'> | null>;
  findUserByEmail(email: string): Promise<UsuarioBasico | null>;
  hasPendingInvitacion(email: string, now: Date): Promise<boolean>;
  mintInvitacion(input: MintInvitacionInput): Promise<InvitacionRow | null>;
}

// ─── Dependencias inyectadas ────────────────────────────────────────────────────

export interface SendCodigoQrInvitationEmailParams {
  to: string;
  invitadoPorNombre: string;
  rolLabel: string;
  inviteUrl: string;
  expiraEnDias: number;
}

export interface OrganizacionPublicaConEstado {
  brand: PublicOrganizationBrand;
  suspended: boolean;
}

export interface CodigosQrDeps {
  repo: CodigosQrRepo;
  // Compone y envía el correo de invitación (con el párrafo "viaQr"); a
  // diferencia de invitaciones.service.ts, el club no se conoce hasta
  // resolver el token, así que recibe el organizationId como parámetro.
  sendInvitationEmail: (organizationId: string, params: SendCodigoQrInvitationEmailParams) => Promise<void>;
  getOrganizationPublic: (organizationId: string) => Promise<OrganizacionPublicaConEstado | null>;
  // Ejecuta `fn` dentro del contexto de tenant del club dado (runWithOrganization).
  withOrganization: <T>(organizationId: string, fn: () => Promise<T>) => Promise<T>;
  now: () => Date;
  frontendUrl: string;
  jwtSecret: string;
  logError: (error: unknown) => void;
}

// ─── Vista pública de un código (nunca expone tokenHash ni tokenCifrado) ──────

export interface CodigoQrPublico {
  id: string;
  etiqueta: string | null;
  rol: RolUsuario;
  maxUsos: number;
  usos: number;
  usosRestantes: number;
  expiresAt: Date;
  revocadoAt: Date | null;
  createdAt: Date;
  estado: EstadoCodigoQr;
  creadoPor: { id: string; name: string } | null;
}

function toPublicView(qr: CodigoQrRow, creadoPor: { id: string; name: string } | null, now: Date): CodigoQrPublico {
  return {
    id: qr.id,
    etiqueta: qr.etiqueta,
    rol: qr.rol,
    maxUsos: qr.maxUsos,
    usos: qr.maxUsos - qr.usosRestantes,
    usosRestantes: qr.usosRestantes,
    expiresAt: qr.expiresAt,
    revocadoAt: qr.revocadoAt,
    createdAt: qr.createdAt,
    estado: estadoCodigoQr(qr, now),
    creadoPor,
  };
}

const MENSAJE_SIN_PERMISO = 'No tienes permiso para invitar';
const MENSAJE_ROL_NO_PERMITIDO = 'No puedes invitar con ese rol';
const MENSAJE_NO_ENCONTRADO = 'Código QR no encontrado';
const MENSAJE_NO_ACTIVO = 'Este código ya no está activo';
const MENSAJE_ENTORNO_DISTINTO = 'Este QR se creó en otro entorno; revócalo y crea uno nuevo.';
const MENSAJE_TOKEN_INVALIDO = 'El código QR no es válido';
const MENSAJE_NO_DISPONIBLE = 'Este código QR ya no está disponible. Pide uno nuevo a quien organiza.';
const MENSAJE_DURACION_INVALIDA = 'Duración inválida';
const MENSAJE_MAX_USOS_INVALIDO = `Los usos máximos deben ser un número entero entre ${QR_MAX_USOS_MIN} y ${QR_MAX_USOS_TOPE}`;
const MENSAJE_ETIQUETA_LARGA = `La etiqueta no puede superar los ${QR_ETIQUETA_MAX} caracteres`;
export const MENSAJE_SOLICITUD_GENERICA =
  'Si el correo puede recibir una invitación, te llegará en unos minutos. Revisa también la carpeta de spam. ' +
  'Si ya tienes cuenta, inicia sesión.';

// ─── crearCodigoQr ──────────────────────────────────────────────────────────────

export interface CrearCodigoQrBody {
  codigo: CodigoQrPublico;
  qrUrl: string;
}

function esDuracionValida(value: unknown): value is QrDuracion {
  return typeof value === 'string' && value in QR_DURACIONES;
}

export async function crearCodigoQr(
  deps: CodigosQrDeps,
  requester: Requester,
  body: { duracion?: unknown; maxUsos?: unknown; etiqueta?: unknown },
): Promise<ServiceResult<CrearCodigoQrBody>> {
  if (!canInvite(requester)) {
    return { ok: false, status: 403, error: MENSAJE_SIN_PERMISO };
  }
  // Un QR siempre otorga SOCIO: esta comprobación es la misma regla de
  // autoridad que crearInvitacion, nunca varía (ADMIN y LIDER pueden ambos
  // invitar SOCIO), pero se mantiene explícita por si esa regla cambia.
  if (!puedeInvitarRol(requester.rol, ROL_QR)) {
    return { ok: false, status: 403, error: MENSAJE_ROL_NO_PERMITIDO };
  }

  const duracionInput = body.duracion === undefined ? QR_DURACION_DEFAULT : body.duracion;
  if (!esDuracionValida(duracionInput)) {
    return { ok: false, status: 400, error: MENSAJE_DURACION_INVALIDA };
  }

  const maxUsosInput = body.maxUsos === undefined ? QR_MAX_USOS_DEFAULT : body.maxUsos;
  if (
    typeof maxUsosInput !== 'number' ||
    !Number.isInteger(maxUsosInput) ||
    maxUsosInput < QR_MAX_USOS_MIN ||
    maxUsosInput > QR_MAX_USOS_TOPE
  ) {
    return { ok: false, status: 400, error: MENSAJE_MAX_USOS_INVALIDO };
  }

  let etiqueta: string | null = null;
  if (body.etiqueta !== undefined && body.etiqueta !== null) {
    if (typeof body.etiqueta !== 'string') {
      return { ok: false, status: 400, error: MENSAJE_ETIQUETA_LARGA };
    }
    const trimmed = body.etiqueta.trim();
    if (trimmed.length > QR_ETIQUETA_MAX) {
      return { ok: false, status: 400, error: MENSAJE_ETIQUETA_LARGA };
    }
    etiqueta = trimmed.length > 0 ? trimmed : null;
  }

  const now = deps.now();
  const expiresAt = new Date(now.getTime() + QR_DURACIONES[duracionInput]);
  const { token, tokenHash } = generateInviteToken();
  const tokenCifrado = cifrarTokenQr(token, deps.jwtSecret);

  const qr = await deps.repo.create({
    organizationId: requester.organizationId,
    tokenHash,
    tokenCifrado,
    etiqueta,
    maxUsos: maxUsosInput,
    usosRestantes: maxUsosInput,
    expiresAt,
    creadoPorId: requester.id,
  });

  // Fragmento (#) a propósito, igual que una invitación individual: nunca
  // llega al servidor ni a los logs del proxy.
  const qrUrl = `${deps.frontendUrl}/#qr=${token}`;

  return {
    ok: true,
    status: 201,
    body: {
      codigo: toPublicView(qr, { id: requester.id, name: requester.name }, now),
      qrUrl,
    },
  };
}

// ─── listarCodigosQr ────────────────────────────────────────────────────────────

async function creadoPorPublico(
  deps: CodigosQrDeps,
  creadoPorId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!creadoPorId) return null;
  const user = await deps.repo.findUserById(creadoPorId);
  return user ? { id: creadoPorId, name: user.name } : null;
}

export async function listarCodigosQr(
  deps: CodigosQrDeps,
  requester: Requester,
): Promise<ServiceResult<{ codigos: CodigoQrPublico[] }>> {
  if (!canInvite(requester)) {
    return { ok: false, status: 403, error: MENSAJE_SIN_PERMISO };
  }

  const now = deps.now();
  const rows = await deps.repo.list(isAdmin(requester) ? {} : { creadoPorId: requester.id });
  const codigos = rows.map((row) =>
    toPublicView(row, row.creadoPorId ? { id: row.creadoPorId, name: row.creadoPorNombre ?? '' } : null, now),
  );

  return { ok: true, status: 200, body: { codigos } };
}

// ─── Alcance compartido de ver/revocar ─────────────────────────────────────────

// ADMIN gestiona cualquier código del club (el aislamiento entre clubes ya lo
// impone el contexto de tenant vigente — ver findById en el repo); un LIDER
// solo los que él mismo creó. Ante falta de acceso se responde 404 (no 403)
// para no revelar existencia, igual que invitaciones.
function tieneAccesoAlCodigo(requester: Requester, qr: CodigoQrRow): boolean {
  return isAdmin(requester) || qr.creadoPorId === requester.id;
}

async function cargarCodigoPropio(
  deps: CodigosQrDeps,
  requester: Requester,
  id: string,
): Promise<CodigoQrRow | { error: ServiceResult<never> }> {
  if (!canInvite(requester)) {
    return { error: { ok: false, status: 403, error: MENSAJE_SIN_PERMISO } };
  }

  const qr = await deps.repo.findById(id);
  if (!qr || !tieneAccesoAlCodigo(requester, qr)) {
    return { error: { ok: false, status: 404, error: MENSAJE_NO_ENCONTRADO } };
  }

  return qr;
}

// ─── verCodigoQr ────────────────────────────────────────────────────────────────

export interface VerCodigoQrBody {
  codigo: CodigoQrPublico;
  qrUrl: string;
}

export async function verCodigoQr(
  deps: CodigosQrDeps,
  requester: Requester,
  id: string,
): Promise<ServiceResult<VerCodigoQrBody>> {
  const qr = await cargarCodigoPropio(deps, requester, id);
  if ('error' in qr) return qr.error;

  const now = deps.now();
  if (estadoCodigoQr(qr, now) !== 'ACTIVO') {
    return { ok: false, status: 409, error: MENSAJE_NO_ACTIVO };
  }

  const token = descifrarTokenQr(qr.tokenCifrado, deps.jwtSecret);
  if (!token) {
    return { ok: false, status: 409, error: MENSAJE_ENTORNO_DISTINTO };
  }

  const creadoPor = await creadoPorPublico(deps, qr.creadoPorId);
  return {
    ok: true,
    status: 200,
    body: {
      codigo: toPublicView(qr, creadoPor, now),
      qrUrl: `${deps.frontendUrl}/#qr=${token}`,
    },
  };
}

// ─── revocarCodigoQr ────────────────────────────────────────────────────────────

export async function revocarCodigoQr(
  deps: CodigosQrDeps,
  requester: Requester,
  id: string,
): Promise<ServiceResult<{ codigo: CodigoQrPublico }>> {
  const qr = await cargarCodigoPropio(deps, requester, id);
  if ('error' in qr) return qr.error;

  const now = deps.now();
  if (estadoCodigoQr(qr, now) !== 'ACTIVO') {
    return { ok: false, status: 409, error: MENSAJE_NO_ACTIVO };
  }

  await deps.repo.markRevoked(id, now);

  const creadoPor = await creadoPorPublico(deps, qr.creadoPorId);
  return {
    ok: true,
    status: 200,
    body: { codigo: toPublicView({ ...qr, revocadoAt: now }, creadoPor, now) },
  };
}

// ─── Validación de vigencia (compartida por consultar y solicitar) ────────────

interface VigenciaQr {
  vigente: true;
  qr: CodigoQrRow;
  org: OrganizacionPublicaConEstado;
  creador: { id: string; name: string; rol: RolUsuario };
}

async function verificarVigenciaQr(
  deps: CodigosQrDeps,
  token: string,
  now: Date,
): Promise<VigenciaQr | ServiceResult<never>> {
  const qr = await deps.repo.findByTokenHash(hashInviteToken(token));
  if (!qr) {
    return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
  }

  if (estadoCodigoQr(qr, now) !== 'ACTIVO') {
    return { ok: false, status: 410, error: MENSAJE_NO_DISPONIBLE };
  }

  const org = await deps.getOrganizationPublic(qr.organizationId);
  if (!org || org.suspended) {
    return { ok: false, status: 410, error: MENSAJE_NO_DISPONIBLE };
  }

  // El QR solo vale lo que valga la autoridad vigente de quien lo creó: si ya
  // no existe o fue degradado por debajo de "puede invitar SOCIO", se trata
  // igual que una revocación (misma regla que verificarVigencia en
  // invitaciones.service.ts).
  const creador = qr.creadoPorId ? await deps.repo.findUserById(qr.creadoPorId) : null;
  if (!creador || !puedeInvitarRol(creador.rol, ROL_QR)) {
    return { ok: false, status: 410, error: MENSAJE_NO_DISPONIBLE };
  }

  return { vigente: true, qr, org, creador: { id: qr.creadoPorId!, name: creador.name, rol: creador.rol } };
}

// ─── consultarCodigoQr (público) ───────────────────────────────────────────────

export interface ConsultarCodigoQrBody {
  organization: PublicOrganizationBrand;
  expiresAt: Date;
}

export async function consultarCodigoQr(
  deps: CodigosQrDeps,
  token: string,
): Promise<ServiceResult<ConsultarCodigoQrBody>> {
  const vigencia = await verificarVigenciaQr(deps, token, deps.now());
  if (!('vigente' in vigencia)) return vigencia;

  return {
    ok: true,
    status: 200,
    body: { organization: vigencia.org.brand, expiresAt: vigencia.qr.expiresAt },
  };
}

// ─── solicitarInvitacionQr (público) ───────────────────────────────────────────

const INVITE_TTL_DIAS = Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000));

export interface SolicitarInvitacionQrBody {
  message: string;
}

// Cada rama devuelve EXACTAMENTE la misma respuesta 202 con el mismo mensaje
// genérico: cuenta existente, invitación ya pendiente y correo nuevo son
// indistinguibles desde afuera (nunca se revela cuál ocurrió, ni el enlace).
export async function solicitarInvitacionQr(
  deps: CodigosQrDeps,
  token: string,
  body: { email?: unknown },
): Promise<ServiceResult<SolicitarInvitacionQrBody>> {
  const now = deps.now();

  // (1) La vigencia del QR se valida primero, independientemente del email.
  const vigencia = await verificarVigenciaQr(deps, token, now);
  if (!('vigente' in vigencia)) return vigencia;

  // (2) Mismo campo/normalización de email que las invitaciones.
  const emailParsed = emailField.safeParse(body.email);
  if (!emailParsed.success) {
    return { ok: false, status: 400, error: emailParsed.error.issues[0]?.message ?? 'Email inválido' };
  }
  const email = emailParsed.data.toLowerCase();
  const { qr, creador } = vigencia;

  // (3) Todo lo que sigue corre en el contexto de tenant del club del QR.
  await deps.withOrganization(qr.organizationId, async () => {
    // findUserByEmail es plataforma-wide (User.email es único en toda la
    // plataforma) pese a correr acá dentro: el repo lo re-envuelve en
    // runAsPlatform él mismo.
    const existing = await deps.repo.findUserByEmail(email);
    if (existing) return;

    // Nunca se revoca una invitación pendiente existente para este email en
    // este club (a diferencia de crearInvitacion): quien sostiene el QR
    // podría, si no, pisar una invitación ADMIN pendiente de otra persona.
    const yaPendiente = await deps.repo.hasPendingInvitacion(email, now);
    if (yaPendiente) return;

    const { token: inviteToken, tokenHash: inviteTokenHash } = generateInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    const minted = await deps.repo.mintInvitacion({
      codigoQrId: qr.id,
      organizationId: qr.organizationId,
      email,
      rol: ROL_QR,
      tokenHash: inviteTokenHash,
      expiresAt,
      invitadoPorId: qr.creadoPorId,
      now,
    });
    // null = se perdió la carrera por el último uso (otra solicitud ganó
    // entre verificarVigenciaQr y este punto): no se envía correo.
    if (!minted) return;

    const inviteUrl = `${deps.frontendUrl}/#invite=${inviteToken}`;
    // Sin await a propósito: la respuesta pública es idéntica exista o no la
    // cuenta, así que nunca debe esperar (ni fallar por) el envío del correo.
    deps
      .sendInvitationEmail(qr.organizationId, {
        to: email,
        invitadoPorNombre: creador.name,
        rolLabel: ROL_LABELS[ROL_QR],
        inviteUrl,
        expiraEnDias: INVITE_TTL_DIAS,
      })
      .catch(deps.logError);
  });

  return { ok: true, status: 202, body: { message: MENSAJE_SOLICITUD_GENERICA } };
}
