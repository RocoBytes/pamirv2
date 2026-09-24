// Lógica de negocio del QR reusable del club, independiente de Prisma y de
// Express — mismo patrón que invitaciones.service.ts: recibe un repositorio
// inyectado (ver codigos-qr.repo.prisma.ts) y devuelve un resultado
// discriminado que el controlador solo mapea a la respuesta HTTP. Se puede
// probar con un repositorio en memoria (ver codigos-qr.service.test.ts).
import type { RolUsuario, ModoCodigoQr } from '../generated/prisma/client.js';
import { emailField, nameField, passwordField } from '../lib/auth-fields.js';
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
  QR_DIRECTO_TTL_MS,
  QR_DIRECTO_MAX_USOS,
  ROL_QR,
  // Renombrado en este módulo: hay una función de servicio pública llamada
  // igual (estadoCodigoQr, la que consulta el panel del inviter) — esta es la
  // función PURA que solo deriva el estado a partir de los datos del código.
  estadoCodigoQr as calcularEstadoCodigoQr,
  cifrarTokenQr,
  descifrarTokenQr,
  type QrDuracion,
  type EstadoCodigoQr,
} from '../lib/codigos-qr.js';
import type {
  UsuarioBasico,
  InvitacionRow,
  Requester,
  ServiceResult,
  AccountMembershipStatus,
  AccountForOwnershipProof,
} from './invitaciones.service.js';

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
  modo: ModoCodigoQr;
  // Solo lo llena un código DIRECTO, y solo una vez (el único uso que tiene).
  registradoUsuarioId: string | null;
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
  modo: ModoCodigoQr;
}

// Resultado del registro atómico de registrarConQrDirecto (ver el servicio,
// más abajo): 'agotado' es la MISMA carrera perdida que mintInvitacion (el
// código ya no estaba disponible al llegar a la transacción); 'email-en-uso'
// es la violación de unicidad de User.email si otra request ganó la carrera
// entre el chequeo previo (findUserByEmail) y este punto.
export type RegistrarQrDirectoResultado =
  | { kind: 'ok'; user: UsuarioBasico }
  | { kind: 'agotado' }
  | { kind: 'email-en-uso' };

export interface RegistrarQrDirectoInput {
  codigoQrId: string;
  organizationId: string;
  email: string;
  name: string;
  passwordHash: string;
  rol: RolUsuario;
  now: Date;
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
  // Incluye email (a diferencia de InvitacionesRepo.findUserById): lo necesita
  // registradoPublico para exponer quién se registró con un QR directo.
  findUserById(id: string): Promise<Pick<UsuarioBasico, 'id' | 'name' | 'rol' | 'email'> | null>;
  findUserByEmail(email: string): Promise<UsuarioBasico | null>;
  // Igual contrato que en InvitacionesRepo — ver AccountMembershipStatus /
  // AccountForOwnershipProof (invitaciones.service.ts, Ruling 2).
  findAccountMembershipStatus(email: string, organizationId: string): Promise<AccountMembershipStatus>;
  findAccountForOwnershipProof(email: string): Promise<AccountForOwnershipProof | null>;
  hasPendingInvitacion(email: string, now: Date): Promise<boolean>;
  mintInvitacion(input: MintInvitacionInput): Promise<InvitacionRow | null>;
  registrarUsuarioQrDirecto(input: RegistrarQrDirectoInput): Promise<RegistrarQrDirectoResultado>;
  // Contraparte de registrarUsuarioQrDirecto para una cuenta YA EXISTENTE:
  // crea solo la Membresia, consumiendo el único uso del código en la misma
  // transacción — nunca crea ni modifica User.
  registrarMembresiaQrDirectoExistente(
    input: RegistrarMembresiaQrDirectoExistenteInput,
  ): Promise<RegistrarQrDirectoExistenteResultado>;
}

export interface RegistrarMembresiaQrDirectoExistenteInput {
  codigoQrId: string;
  organizationId: string;
  usuarioId: string;
  rol: RolUsuario;
  now: Date;
}

export type RegistrarQrDirectoExistenteResultado = { kind: 'ok' } | { kind: 'agotado' };

// ─── Dependencias inyectadas ────────────────────────────────────────────────────

export interface SendCodigoQrInvitationEmailParams {
  to: string;
  invitadoPorNombre: string;
  rolLabel: string;
  inviteUrl: string;
  expiraEnDias: number;
  existingAccount: boolean;
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
  // Solo lo usa registrarConQrDirecto (el QR reusable nunca da de alta una
  // cuenta directamente) — mismo cableado que InvitacionesDeps.hashPassword.
  hashPassword: (password: string) => Promise<string>;
  comparePassword: (password: string, hash: string) => Promise<boolean>;
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
  modo: ModoCodigoQr;
  // Quién se registró con este código (solo puede ser no-null en uno DIRECTO
  // ya AGOTADO). null en todo lo demás, incluido cualquier código CORREO.
  registrado: { name: string; email: string } | null;
}

function toPublicView(
  qr: CodigoQrRow,
  creadoPor: { id: string; name: string } | null,
  now: Date,
  registrado: { name: string; email: string } | null = null,
): CodigoQrPublico {
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
    estado: calcularEstadoCodigoQr(qr, now),
    creadoPor,
    modo: qr.modo,
    registrado,
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
const MENSAJE_MODO_INVALIDO = 'Modo inválido';
// Distinto del mensaje de invitaciones.service.ts ("Ya existe una cuenta con
// ese correo"): acá quien registra está parado frente a la app, así que el
// siguiente paso ("Inicia sesión") es información útil en el momento.
const MENSAJE_CUENTA_EXISTENTE_QR_DIRECTO = 'Ya existe una cuenta con ese correo. Inicia sesión.';
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

function esModoValido(value: unknown): value is ModoCodigoQr {
  return value === 'CORREO' || value === 'DIRECTO';
}

export async function crearCodigoQr(
  deps: CodigosQrDeps,
  requester: Requester,
  body: { modo?: unknown; duracion?: unknown; maxUsos?: unknown; etiqueta?: unknown },
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

  const modoInput = body.modo === undefined ? 'CORREO' : body.modo;
  if (!esModoValido(modoInput)) {
    return { ok: false, status: 400, error: MENSAJE_MODO_INVALIDO };
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
  let expiresAt: Date;
  let maxUsos: number;

  if (modoInput === 'DIRECTO') {
    // Un código directo SIEMPRE dura QR_DIRECTO_TTL_MS y sirve una sola vez:
    // duracion/maxUsos del body se ignoran a propósito, nunca se validan.
    expiresAt = new Date(now.getTime() + QR_DIRECTO_TTL_MS);
    maxUsos = QR_DIRECTO_MAX_USOS;
  } else {
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

    expiresAt = new Date(now.getTime() + QR_DURACIONES[duracionInput]);
    maxUsos = maxUsosInput;
  }

  const { token, tokenHash } = generateInviteToken();
  const tokenCifrado = cifrarTokenQr(token, deps.jwtSecret);

  const qr = await deps.repo.create({
    organizationId: requester.organizationId,
    tokenHash,
    tokenCifrado,
    etiqueta,
    maxUsos,
    usosRestantes: maxUsos,
    expiresAt,
    creadoPorId: requester.id,
    modo: modoInput,
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

// Quién se registró con un código DIRECTO ya AGOTADO (ver estadoCodigoQr más
// abajo) — no-op (sin consulta) para cualquier código sin registradoUsuarioId,
// que es el caso de todo código CORREO y de un DIRECTO todavía sin usar.
async function registradoPublico(
  deps: CodigosQrDeps,
  registradoUsuarioId: string | null,
): Promise<{ name: string; email: string } | null> {
  if (!registradoUsuarioId) return null;
  const user = await deps.repo.findUserById(registradoUsuarioId);
  return user ? { name: user.name, email: user.email } : null;
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
  // Un QR directo ya usado/vencido/revocado deja de listarse: su único uso ya
  // se resolvió (ver el panel de "QR directo" en el frontend, que lo muestra
  // mientras espera) y no hay ninguna acción de gestión que quede pendiente
  // sobre él. Un QR reusable (CORREO) se sigue listando en cualquier estado,
  // como siempre.
  const visibles = rows.filter((row) => row.modo !== 'DIRECTO' || calcularEstadoCodigoQr(row, now) === 'ACTIVO');
  const codigos = visibles.map((row) =>
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
  if (calcularEstadoCodigoQr(qr, now) !== 'ACTIVO') {
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

// ─── estadoCodigoQr ─────────────────────────────────────────────────────────────
// Lo consulta el panel de "QR directo" mientras espera a que alguien escanee:
// a diferencia de verCodigoQr, NO exige que el código siga ACTIVO (todo lo
// contrario — el propósito es enterarse del momento exacto en que deja de
// estarlo, con quién se registró).

export interface EstadoCodigoQrBody {
  estado: EstadoCodigoQr;
  registrado: { name: string; email: string } | null;
  expiresAt: Date;
}

export async function estadoCodigoQr(
  deps: CodigosQrDeps,
  requester: Requester,
  id: string,
): Promise<ServiceResult<EstadoCodigoQrBody>> {
  const qr = await cargarCodigoPropio(deps, requester, id);
  if ('error' in qr) return qr.error;

  const now = deps.now();
  const registrado = await registradoPublico(deps, qr.registradoUsuarioId);

  return {
    ok: true,
    status: 200,
    body: { estado: calcularEstadoCodigoQr(qr, now), registrado, expiresAt: qr.expiresAt },
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
  if (calcularEstadoCodigoQr(qr, now) !== 'ACTIVO') {
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

  if (calcularEstadoCodigoQr(qr, now) !== 'ACTIVO') {
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
  // El frontend decide qué formulario pintar con esto: solicitar-por-correo
  // (CORREO, de siempre) o registro directo en el momento (DIRECTO).
  modo: ModoCodigoQr;
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
    body: { organization: vigencia.org.brand, expiresAt: vigencia.qr.expiresAt, modo: vigencia.qr.modo },
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

  // Un código DIRECTO nunca mintea invitaciones por correo: se trata como si
  // el token no existiera (mismo 404 que uno desconocido), nunca un 410 —
  // este endpoint simplemente no lo conoce.
  if (vigencia.qr.modo === 'DIRECTO') {
    return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
  }

  // (2) Mismo campo/normalización de email que las invitaciones.
  const emailParsed = emailField.safeParse(body.email);
  if (!emailParsed.success) {
    return { ok: false, status: 400, error: emailParsed.error.issues[0]?.message ?? 'Email inválido' };
  }
  const email = emailParsed.data.toLowerCase();
  const { qr, creador } = vigencia;

  // (3) Todo lo que sigue corre en el contexto de tenant del club del QR.
  await deps.withOrganization(qr.organizationId, async () => {
    // Antes de la fase "Joining", una cuenta existente cortaba acá sin
    // mintear nada. Desde esta PR, solo se sigue cortando si YA es socia de
    // ESTE club — si tiene cuenta en otro club, o no tiene cuenta, el flujo
    // es el mismo: mintear la invitación (el correo cambia de texto según
    // cuentaExiste; la respuesta pública NUNCA cambia — sigue siendo el
    // mismo 202 genérico en los tres casos, ver Ruling 6 del plan de esta
    // PR: nadie que escanea un QR público debe poder distinguirlos).
    const estado = await deps.repo.findAccountMembershipStatus(email, qr.organizationId);
    if (estado.esSocioDeEsteClub) return;

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
        existingAccount: estado.cuentaExiste,
      })
      .catch(deps.logError);
  });

  return { ok: true, status: 202, body: { message: MENSAJE_SOLICITUD_GENERICA } };
}

// ─── registrarConQrDirecto (público) ───────────────────────────────────────────
// Contraparte DIRECTO de solicitarInvitacionQr: en vez de mintear una
// Invitacion y enviar un correo, da de alta la cuenta EN EL ACTO (nombre +
// email + contraseña, sin paso de verificación — el propio QR de un solo uso,
// mostrado en persona, hace las veces de esa verificación). El frontend inicia
// sesión después con las credenciales recién creadas (POST /api/auth/login),
// igual que el flujo de aceptar una invitación normal.

export interface RegistrarConQrDirectoBody {
  ok: true;
}

export async function registrarConQrDirecto(
  deps: CodigosQrDeps,
  token: string,
  body: { name?: unknown; email?: unknown; password?: unknown },
): Promise<ServiceResult<RegistrarConQrDirectoBody>> {
  const now = deps.now();

  // (1) Vigencia del token primero, igual que solicitarInvitacionQr — un
  // token desconocido O en modo CORREO se trata igual: no existe para este
  // endpoint (nunca mezcla su 410 con el 404 de "no es un QR directo").
  const vigencia = await verificarVigenciaQr(deps, token, now);
  if (!('vigente' in vigencia)) return vigencia;
  if (vigencia.qr.modo !== 'DIRECTO') {
    return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
  }

  // (2) Mismas reglas y mensajes que aceptarInvitacion, para que la persona
  // vea exactamente la misma validación en cualquiera de los dos caminos.
  const nameParsed = nameField.safeParse(body.name);
  if (!nameParsed.success) {
    return { ok: false, status: 400, error: nameParsed.error.issues[0]?.message ?? 'Nombre inválido' };
  }
  const emailParsed = emailField.safeParse(body.email);
  if (!emailParsed.success) {
    return { ok: false, status: 400, error: emailParsed.error.issues[0]?.message ?? 'Email inválido' };
  }
  const passwordParsed = passwordField.safeParse(body.password);
  if (!passwordParsed.success) {
    return { ok: false, status: 400, error: passwordParsed.error.issues[0]?.message ?? 'Contraseña inválida' };
  }
  const email = emailParsed.data.toLowerCase();
  const { qr } = vigencia;

  // (3) Todo lo que sigue corre en el contexto de tenant del club del QR.
  return deps.withOrganization(qr.organizationId, async (): Promise<ServiceResult<RegistrarConQrDirectoBody>> => {
    // Chequeo previo (plataforma-wide, como en aceptarInvitacion): si ya hay
    // cuenta con este correo, el único uso del código NUNCA se consume.
    const existing = await deps.repo.findUserByEmail(email);
    if (existing) {
      return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE_QR_DIRECTO };
    }

    const passwordHash = await deps.hashPassword(passwordParsed.data);

    const resultado = await deps.repo.registrarUsuarioQrDirecto({
      codigoQrId: qr.id,
      organizationId: qr.organizationId,
      email,
      name: nameParsed.data,
      passwordHash,
      rol: ROL_QR,
      now,
    });

    if (resultado.kind === 'agotado') {
      // Carrera perdida por el único uso entre verificarVigenciaQr y este
      // punto: mismo mensaje/estado que cualquier otro código no disponible.
      return { ok: false, status: 410, error: MENSAJE_NO_DISPONIBLE };
    }
    if (resultado.kind === 'email-en-uso') {
      // Carrera perdida contra otra request concurrente para el MISMO email
      // (el chequeo de arriba ya no alcanza a verla): el uso no se consumió,
      // la transacción del repo revirtió el decremento.
      return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE_QR_DIRECTO };
    }

    return { ok: true, status: 201, body: { ok: true } };
  });
}
