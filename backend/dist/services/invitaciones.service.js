import { emailField, nameField, passwordField } from '../lib/auth-fields.js';
import { canInvite, isAdmin } from '../lib/authz.js';
import { INVITE_TTL_MS, generateInviteToken, hashInviteToken, puedeInvitarRol, estadoInvitacion, ROL_LABELS, } from '../lib/invitaciones.js';
const INVITE_TTL_DIAS = Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000));
function toPublicView(inv, invitadoPor, now) {
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
async function invitadoPorPublico(deps, invitadoPorId) {
    if (!invitadoPorId)
        return null;
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
async function enviarCorreoInvitacion(deps, params) {
    try {
        await deps.sendEmail(params);
        return true;
    }
    catch {
        return false;
    }
}
export async function crearInvitacion(deps, requester, body) {
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
    const rol = rolInput;
    const existing = await deps.repo.findUserByEmail(email);
    if (existing) {
        return { ok: false, status: 409, error: MENSAJE_CUENTA_EXISTENTE };
    }
    const now = deps.now();
    await deps.repo.revokePendingForEmail(email, now);
    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const invitacion = await deps.repo.createInvitacion({
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
export async function listarInvitaciones(deps, requester) {
    if (!canInvite(requester)) {
        return { ok: false, status: 403, error: MENSAJE_SIN_PERMISO };
    }
    const now = deps.now();
    const rows = await deps.repo.list(isAdmin(requester) ? {} : { invitadoPorId: requester.id });
    const invitaciones = rows.map((row) => toPublicView(row, row.invitadoPorId ? { id: row.invitadoPorId, name: row.invitadoPorNombre ?? '' } : null, now));
    return { ok: true, status: 200, body: { invitaciones } };
}
// ─── Alcance compartido de revocar/reenviar ────────────────────────────────────
// ADMIN gestiona cualquier invitación; un LIDER solo las que él mismo envió.
// Ante falta de acceso se responde 404 (no 403) para no revelar existencia.
function tieneAccesoAInvitacion(requester, inv) {
    return isAdmin(requester) || inv.invitadoPorId === requester.id;
}
async function cargarInvitacionPropia(deps, requester, id) {
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
export async function revocarInvitacion(deps, requester, id) {
    const inv = await cargarInvitacionPropia(deps, requester, id);
    if ('error' in inv)
        return inv.error;
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
export async function reenviarInvitacion(deps, requester, id) {
    const inv = await cargarInvitacionPropia(deps, requester, id);
    if ('error' in inv)
        return inv.error;
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
async function verificarVigencia(deps, inv, now) {
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
export async function consultarInvitacion(deps, token) {
    const inv = await deps.repo.findByTokenHash(hashInviteToken(token));
    if (!inv) {
        return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
    }
    const now = deps.now();
    const vigencia = await verificarVigencia(deps, inv, now);
    if (!('vigente' in vigencia))
        return vigencia;
    return {
        ok: true,
        status: 200,
        body: { email: inv.email, rol: inv.rol, rolLabel: ROL_LABELS[inv.rol], invitadoPor: vigencia.inviter.name },
    };
}
export async function aceptarInvitacion(deps, token, body) {
    const inv = await deps.repo.findByTokenHash(hashInviteToken(token));
    if (!inv) {
        return { ok: false, status: 404, error: MENSAJE_TOKEN_INVALIDO };
    }
    const now = deps.now();
    const vigencia = await verificarVigencia(deps, inv, now);
    if (!('vigente' in vigencia))
        return vigencia;
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
