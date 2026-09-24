// Lógica de negocio de las invitaciones, independiente de Prisma y de Express:
// recibe un repositorio inyectado (ver invitaciones.repo.prisma.ts para la
// implementación real) y devuelve un resultado discriminado que el controlador
// solo tiene que mapear a la respuesta HTTP. Así se puede probar con un
// repositorio en memoria (ver invitaciones.service.test.ts) — los Proxies del
// cliente de Prisma 7 no se pueden mockear con mock.method de node:test.
import type { RolUsuario } from '../generated/prisma/client.js';
import { emailField, nameField, passwordField } from '../lib/auth-fields.js';
import { canInvite, isAdmin } from '../lib/authz.js';
import type { PublicOrganizationBrand } from '../lib/serializers/organization.js';
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
  // Invitación emitida por la plataforma (sin invitador), usada para dar de
  // alta al primer ADMIN de un club nuevo — ver crearInvitacionPlataforma.
  emitidaPorPlataforma: boolean;
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
  // null solo para una invitación emitida por la plataforma (ver
  // crearInvitacionPlataforma); toda invitación normal trae un invitador.
  invitadoPorId: string | null;
  emitidaPorPlataforma: boolean;
  // Código QR reusable que mintió esta invitación (ver
  // services/codigos-qr.service.ts, solicitarInvitacionQr). Opcional: toda
  // invitación creada por este archivo (crearInvitacion,
  // crearInvitacionPlataforma, reenviarInvitacion) sigue sin tocarlo, así que
  // el comportamiento existente no cambia.
  codigoQrId?: string | null;
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
  findUserById(id: string): Promise<Pick<UsuarioBasico, 'id' | 'name' | 'rol'> | null>;
  // Una sola consulta que responde "existe" y "ya es socia de ESTE club" a
  // la vez — ver AccountMembershipStatus arriba (Ruling 2).
  findAccountMembershipStatus(email: string, organizationId: string): Promise<AccountMembershipStatus>;
  // Lo mínimo para verificar titularidad (incluye passwordHash) — separado
  // de un UsuarioBasico para no exponer el hash a ningún llamador que no lo
  // necesite.
  findAccountForOwnershipProof(email: string): Promise<AccountForOwnershipProof | null>;
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
  // Contraparte de acceptInvitacion para una cuenta YA EXISTENTE: crea SOLO
  // la Membresia (nunca toca User), consumiendo la invitación en la misma
  // transacción. true = se unió; false = la invitación ya no estaba
  // disponible (carrera) — mismo contrato ok/null que acceptInvitacion,
  // adaptado a que acá no hay un UsuarioBasico nuevo que devolver.
  acceptInvitacionExistente(input: AceptarInvitacionExistenteInput): Promise<boolean>;
}

export interface AceptarInvitacionExistenteInput {
  invitacionId: string;
  organizationId: string;
  usuarioId: string;
  rol: RolUsuario;
  now: Date;
}

// ─── Dependencias inyectadas ────────────────────────────────────────────────────

export interface SendInvitationEmailParams {
  to: string;
  invitadoPorNombre: string;
  rolLabel: string;
  inviteUrl: string;
  expiraEnDias: number;
  // La persona invitada ya tiene una cuenta RIALA (en este club o en otro):
  // el correo debe decir "inicia sesión" en vez de "crea tu cuenta" (ver
  // lib/email-templates.ts). El admin que invita NUNCA ve este campo ni nada
  // derivado de él — solo cambia el texto del correo que recibe el invitado.
  existingAccount: boolean;
}

export interface InvitacionesDeps {
  repo: InvitacionesRepo;
  // Envía el correo de invitación ya compuesto (HTML incluido); el servicio
  // nunca construye HTML — eso vive en lib/email-templates.ts, cableado por
  // el controlador.
  sendEmail: (params: SendInvitationEmailParams) => Promise<void>;
  hashPassword: (password: string) => Promise<string>;
  // Comparación de tiempo constante contra un hash ya guardado — usada solo
  // por la rama de "cuenta existente" de aceptarInvitacion (ver
  // verificarPruebaDeCuentaExistente). Igual patrón de inyección que
  // hashPassword: el servicio nunca importa bcrypt directamente.
  comparePassword: (password: string, hash: string) => Promise<boolean>;
  now: () => Date;
  frontendUrl: string;
  // Slug del club de esta request — SIEMPRE el propio club de quien invita
  // (buildDeps ya construye estas deps por request, a partir de
  // req.user!.organization, que ya trae slug). Nunca se resuelve con una
  // consulta nueva en el punto de armar el link (ver Ruling 6 del plan de
  // esta PR).
  organizationSlug: string;
  // Resuelve la marca pública (slug/name/shortName) de un club por su id.
  // Solo lo usa consultarInvitacion (endpoint público, sin sesión) para
  // mostrar el club que invita antes de que la persona inicie sesión.
  // Opcional: los flujos autenticados (crear/listar/revocar/reenviar) nunca
  // lo necesitan, y los dobles de prueba que no consultan invitaciones no
  // tienen por qué implementarlo.
  getOrganizationBrand?: (organizationId: string) => Promise<PublicOrganizationBrand | null>;
}

// ─── Requester (subconjunto de AuthUser que necesita este módulo) ─────────────

export interface Requester {
  id: string;
  organizationId: string;
  name: string;
  rol: RolUsuario;
}

// ─── Prueba de titularidad de una cuenta existente (PR "Joining") ─────────────
// Ver docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §2
// "Joining a club" y el plan de esta PR (Rulings 2, 3). Compartido por
// aceptarInvitacion (este archivo) y registrarConQrDirecto
// (codigos-qr.service.ts, que importa estos símbolos de acá).

// Una consulta, dos datos: si la cuenta existe Y si ya es socia de ESTE
// club — nunca dos consultas separadas (ver Ruling 2: una consulta extra
// SOLO cuando la cuenta existe es un canal de tiempo que revela su
// existencia al admin que invita, algo que el diseño prohíbe
// explícitamente).
export interface AccountMembershipStatus {
  cuentaExiste: boolean;
  // Solo tiene sentido cuando cuentaExiste es true.
  esSocioDeEsteClub: boolean;
}

// Lo mínimo para verificar titularidad — nunca se expone fuera de la rama de
// prueba de titularidad (nunca se mezcla con UsuarioBasico, que si se
// serializa en una vista pública).
export interface AccountForOwnershipProof {
  id: string;
  email: string;
  passwordHash: string | null;
}

// Ya verificado por el controlador (lib/verified-email.ts) antes de llegar
// acá — el servicio NUNCA decodifica un JWT él mismo.
export interface AuthProof {
  verifiedEmail: string | null;
}

export type OwnershipProofResult = { ok: true } | { ok: false; status: number; error: string };

// Prueba que quien está aceptando/registrándose es dueño de una cuenta YA
// EXISTENTE con este email: por Bearer (si coincide exactamente con el email
// de la cuenta) o, si no hay Bearer, por contraseña (bcrypt, tiempo
// constante — igual que login). Los mensajes se inyectan porque cada
// endpoint usa su propio texto (ver Ruling 5 del plan de esta PR).
export async function verificarPruebaDeCuentaExistente(
  deps: { comparePassword: (password: string, hash: string) => Promise<boolean> },
  account: AccountForOwnershipProof,
  auth: AuthProof,
  submittedPassword: string | undefined,
  mensajes: { correoDistinto: string; contrasenaIncorrecta: string },
): Promise<OwnershipProofResult> {
  if (auth.verifiedEmail !== null) {
    if (auth.verifiedEmail !== account.email) {
      return { ok: false, status: 403, error: mensajes.correoDistinto };
    }
    return { ok: true };
  }

  if (!account.passwordHash || submittedPassword === undefined) {
    return { ok: false, status: 401, error: mensajes.contrasenaIncorrecta };
  }
  const matches = await deps.comparePassword(submittedPassword, account.passwordHash);
  if (!matches) {
    return { ok: false, status: 401, error: mensajes.contrasenaIncorrecta };
  }
  return { ok: true };
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
  emitidaPorPlataforma: boolean;
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
    emitidaPorPlataforma: inv.emitidaPorPlataforma,
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
const MENSAJE_YA_SOCIO_CLUB = 'Ya es socio de este club';
const MENSAJE_NO_PENDIENTE = 'La invitación ya no está pendiente';
const MENSAJE_NO_ENCONTRADA = 'Invitación no encontrada';
const MENSAJE_TOKEN_INVALIDO = 'La invitación no es válida';
const MENSAJE_YA_UTILIZADA = 'Esta invitación ya fue utilizada. Inicia sesión.';
const MENSAJE_EXPIRADA = 'La invitación expiró. Pide a quien te invitó que la reenvíe.';
const MENSAJE_NO_VIGENTE = 'La invitación ya no está vigente';
const MENSAJE_ROL_INVALIDO = 'Rol inválido';
// Usados solo por la rama de "cuenta existente" de aceptarInvitacion (PR
// "Joining", Task 3) — ver verificarPruebaDeCuentaExistente.
const MENSAJE_INVITACION_OTRO_CORREO = 'Esta invitación es para otro correo';
const MENSAJE_CONTRASENA_INCORRECTA = 'Ya tienes una cuenta con este correo. Verifica tu contraseña e inténtalo de nuevo.';

// Nombre que se muestra como "invitado por" cuando la invitación la emitió la
// plataforma (sin invitador) — ver crearInvitacionPlataforma.
const PLATAFORMA_NOMBRE = 'el equipo de la plataforma';

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

  // Una sola consulta que responde a la vez "existe" y "ya es socia de ESTE
  // club" (ver Ruling 2 del plan de esta PR) — el admin nunca aprende cuál
  // de los dos casos restantes ocurrió, ni por el body de la respuesta ni
  // por el tiempo que tarda: el camino de abajo es idéntico en ambos.
  const estado = await deps.repo.findAccountMembershipStatus(email, requester.organizationId);
  if (estado.esSocioDeEsteClub) {
    return { ok: false, status: 409, error: MENSAJE_YA_SOCIO_CLUB };
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
    emitidaPorPlataforma: false,
  });

  // Segmento del club ANTES del fragmento (#): nginx sirve index.html para
  // cualquier path (SPA fallback), así que /<slug>/#invite=<token> llega
  // intacto al frontend — ver docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
  const inviteUrl = `${deps.frontendUrl}/${deps.organizationSlug}/#invite=${token}`;

  const emailEnviado = await enviarCorreoInvitacion(deps, {
    to: email,
    invitadoPorNombre: requester.name,
    rolLabel: ROL_LABELS[rol],
    inviteUrl,
    expiraEnDias: INVITE_TTL_DIAS,
    existingAccount: estado.cuentaExiste,
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

  const estadoCuenta = await deps.repo.findAccountMembershipStatus(inv.email, requester.organizationId);
  if (estadoCuenta.esSocioDeEsteClub) {
    return { ok: false, status: 409, error: MENSAJE_YA_SOCIO_CLUB };
  }

  await deps.repo.markRevoked(id, now);

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  // Un reenvío siempre produce una invitación normal emitida por quien
  // reenvía, aunque la original haya sido emitida por la plataforma.
  const nueva = await deps.repo.createInvitacion({
    organizationId: requester.organizationId,
    email: inv.email,
    rol: inv.rol,
    tokenHash,
    expiresAt,
    invitadoPorId: requester.id,
    emitidaPorPlataforma: false,
  });

  // Segmento del club ANTES del fragmento (#): nginx sirve index.html para
  // cualquier path (SPA fallback), así que /<slug>/#invite=<token> llega
  // intacto al frontend — ver docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
  const inviteUrl = `${deps.frontendUrl}/${deps.organizationSlug}/#invite=${token}`;

  const emailEnviado = await enviarCorreoInvitacion(deps, {
    to: inv.email,
    invitadoPorNombre: requester.name,
    rolLabel: ROL_LABELS[inv.rol],
    inviteUrl,
    expiraEnDias: INVITE_TTL_DIAS,
    existingAccount: estadoCuenta.cuentaExiste,
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
  // null cuando la invitación fue emitida por la plataforma: no tiene
  // invitador por diseño (ver crearInvitacionPlataforma), no porque se haya
  // borrado.
  inviter: Pick<UsuarioBasico, 'id' | 'name' | 'rol'> | null;
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

  // Una invitación emitida por la plataforma no tiene invitador por diseño:
  // queda exenta de la regla de autoridad vigente de abajo.
  if (inv.emitidaPorPlataforma) {
    return { vigente: true, inviter: null };
  }

  // Una invitación normal solo vale lo que valga la autoridad vigente de
  // quien la envió: si ya no existe o fue degradado por debajo del rol
  // otorgado, se trata igual que una revocación.
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
  // null cuando deps no expone getOrganizationBrand (dobles de prueba); el
  // controlador real (buildPublicDeps) siempre lo resuelve.
  organization: PublicOrganizationBrand | null;
  // true si el email invitado ya tiene una cuenta RIALA (en este club o en
  // otro). Solo se expone acá — la propia pantalla de quien SOSTIENE el
  // token, consultando SU PROPIO email — nunca en una vista de admin (ver
  // Global Constraints del plan de esta PR). Permite que la pantalla de
  // aceptar invitación (PR 4b) muestre "inicia sesión" en vez de "crea tu
  // cuenta" sin depender de que el correo lo haya dejado claro.
  cuentaExistente: boolean;
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

  const organization = deps.getOrganizationBrand ? await deps.getOrganizationBrand(inv.organizationId) : null;
  const existing = await deps.repo.findAccountForOwnershipProof(inv.email);

  return {
    ok: true,
    status: 200,
    body: {
      email: inv.email,
      rol: inv.rol,
      rolLabel: ROL_LABELS[inv.rol],
      invitadoPor: vigencia.inviter ? vigencia.inviter.name : PLATAFORMA_NOMBRE,
      organization,
      cuentaExistente: existing !== null,
    },
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
  auth: AuthProof,
): Promise<ServiceResult<AceptarInvitacionBody>> {
  const inv = await deps.repo.findByTokenHash(hashInviteToken(token));
  if (!inv) {
    return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
  }

  const now = deps.now();
  const vigencia = await verificarVigencia(deps, inv, now);
  if (!('vigente' in vigencia)) return vigencia;

  // El email y el rol nunca se leen del body: solo importan los de la
  // invitación.
  const existing = await deps.repo.findAccountForOwnershipProof(inv.email);

  if (existing) {
    // Cuenta existente (fase "Joining", ver el plan de esta PR): unirse a un
    // club nuevo requiere PROBAR que se es dueño de esa cuenta. name del
    // body se ignora siempre — el perfil compartido nunca se toca acá. Si
    // hay un Bearer verificado, la contraseña ni se valida ni se lee: es la
    // rama que usará la pantalla de PR 4. Sin Bearer, la contraseña sí es
    // obligatoria — mismo rate limit por token que login (ver Ruling 4 del
    // plan de esta PR: app.ts's inviteTokenKey limiter, 10/15min).
    let submittedPassword: string | undefined;
    if (auth.verifiedEmail === null) {
      const passwordParsed = passwordField.safeParse(body.password);
      if (!passwordParsed.success) {
        return { ok: false, status: 400, error: passwordParsed.error.issues[0]?.message ?? 'Contraseña inválida' };
      }
      submittedPassword = passwordParsed.data;
    }

    const prueba = await verificarPruebaDeCuentaExistente(deps, existing, auth, submittedPassword, {
      correoDistinto: MENSAJE_INVITACION_OTRO_CORREO,
      contrasenaIncorrecta: MENSAJE_CONTRASENA_INCORRECTA,
    });
    if (!prueba.ok) return prueba;

    const unido = await deps.repo.acceptInvitacionExistente({
      invitacionId: inv.id,
      organizationId: inv.organizationId,
      usuarioId: existing.id,
      rol: inv.rol,
      now,
    });
    if (!unido) {
      return { ok: false, status: 409, error: MENSAJE_NO_PENDIENTE };
    }

    return {
      ok: true,
      status: 201,
      body: { message: 'Te uniste al club. Ya puedes iniciar sesión.', email: existing.email },
    };
  }

  // Sin cuenta: el flujo de siempre (crea User + Membresia).
  const nameParsed = nameField.safeParse(body.name);
  if (!nameParsed.success) {
    return { ok: false, status: 400, error: nameParsed.error.issues[0]?.message ?? 'Nombre inválido' };
  }
  const passwordParsed = passwordField.safeParse(body.password);
  if (!passwordParsed.success) {
    return { ok: false, status: 400, error: passwordParsed.error.issues[0]?.message ?? 'Contraseña inválida' };
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

// ─── crearInvitacionPlataforma ──────────────────────────────────────────────────
// Invitación emitida directamente por la plataforma, sin invitador: nace para
// dar de alta al primer ADMIN de un club nuevo (que todavía no tiene a nadie
// que lo invite). No hay endpoint HTTP para esto — lo llamará un CLI de
// administración en una fase posterior, ya envuelto en el contexto de club
// correspondiente (runWithOrganization).

const ROLES_VALIDOS = Object.keys(ROL_LABELS) as RolUsuario[];

export interface CrearInvitacionPlataformaInput {
  organizationId: string;
  email: unknown;
  rol: unknown;
}

export async function crearInvitacionPlataforma(
  deps: InvitacionesDeps,
  input: CrearInvitacionPlataformaInput,
): Promise<ServiceResult<CrearInvitacionBody>> {
  const emailParsed = emailField.safeParse(input.email);
  if (!emailParsed.success) {
    return { ok: false, status: 400, error: emailParsed.error.issues[0]?.message ?? 'Email inválido' };
  }
  const email = emailParsed.data.toLowerCase();

  if (typeof input.rol !== 'string' || !(ROLES_VALIDOS as string[]).includes(input.rol)) {
    return { ok: false, status: 400, error: MENSAJE_ROL_INVALIDO };
  }
  const rol = input.rol as RolUsuario;

  const estado = await deps.repo.findAccountMembershipStatus(email, input.organizationId);
  if (estado.esSocioDeEsteClub) {
    return { ok: false, status: 409, error: MENSAJE_YA_SOCIO_CLUB };
  }

  const now = deps.now();
  await deps.repo.revokePendingForEmail(email, now);

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const invitacion = await deps.repo.createInvitacion({
    organizationId: input.organizationId,
    email,
    rol,
    tokenHash,
    expiresAt,
    invitadoPorId: null,
    emitidaPorPlataforma: true,
  });

  // Segmento del club ANTES del fragmento (#): nginx sirve index.html para
  // cualquier path (SPA fallback), así que /<slug>/#invite=<token> llega
  // intacto al frontend — ver docs/superpowers/specs/2026-09-23-multi-club-membership-design.md §3.
  const inviteUrl = `${deps.frontendUrl}/${deps.organizationSlug}/#invite=${token}`;

  const emailEnviado = await enviarCorreoInvitacion(deps, {
    to: email,
    invitadoPorNombre: PLATAFORMA_NOMBRE,
    rolLabel: ROL_LABELS[rol],
    inviteUrl,
    expiraEnDias: INVITE_TTL_DIAS,
    existingAccount: estado.cuentaExiste,
  });

  return {
    ok: true,
    status: 201,
    body: {
      invitacion: toPublicView(invitacion, null, now),
      inviteUrl,
      emailEnviado,
    },
  };
}
