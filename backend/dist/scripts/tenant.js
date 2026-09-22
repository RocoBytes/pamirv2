// CLI de administración de clubes (alta, listado, suspensión/reactivación y
// reenvío de la invitación del primer ADMIN). Corre siempre en contexto de
// plataforma (runAsPlatform): a diferencia de create-user.ts, que opera sobre
// un club ya elegido, este script ES quien da de alta clubes nuevos.
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { verifyDbTargetOrExit as guardVerifyDbTargetOrExit } from '../lib/db-target-guard.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { parseTenantArgs } from './tenant-args.js';
import { crearClub, listarClubes, cambiarEstadoClub, invitarAdminClub, actualizarClub, } from '../services/tenants.service.js';
import { tenantsRepoPrisma } from '../services/tenants.repo.prisma.js';
import { invitacionesRepoPrisma } from '../services/invitaciones.repo.prisma.js';
import { crearInvitacionPlataforma } from '../services/invitaciones.service.js';
import { sendClubEmail } from '../lib/email/club-email.js';
import { buildInvitationEmail, brandingFor } from '../lib/email-templates.js';
import { subjectInvitacion } from '../lib/email/subjects.js';
import { SALT_ROUNDS } from '../lib/auth-fields.js';
import { FRONTEND_URL } from '../lib/config.js';
// Defensa en profundidad: npm run tenant:* ya ejecuta el guard como pre-hook,
// pero este script también puede invocarse directamente con tsx (o, en el
// contenedor de producción, con node dist/scripts/tenant.js — ver README).
function verifyDbTargetOrExit() {
    guardVerifyDbTargetOrExit({
        prefix: '[tenant]',
        honorAllowAny: true,
        failureMessage: '[tenant] Comando abortado: DATABASE_URL no coincide con la base de datos de v2 declarada en ' +
            'backend/db-target.json. Si esto corre en el contenedor de producción, define ALLOW_ANY_DB_TARGET=1.',
    });
}
// Reutilizada por "create" (primer ADMIN de un club nuevo) e "invite"
// (reenvío para un club ya existente): dado el id de un club YA CREADO,
// arma las deps reales de invitaciones.service.ts y emite la invitación de
// plataforma. Mismo cableado de correo que buildDeps en
// controllers/invitaciones.controller.ts, cambiando solo el contexto (acá lo
// establece runWithOrganization en vez de venir de req.user).
const crearInvitacionAdmin = (organizationId, email) => runWithOrganization(organizationId, async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const deps = {
        repo: invitacionesRepoPrisma,
        sendEmail: async (params) => {
            const branding = brandingFor(organization);
            await sendClubEmail(organization, {
                to: params.to,
                subject: subjectInvitacion(branding),
                html: buildInvitationEmail(params, branding),
                kind: 'notificacion',
            });
        },
        hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
        now: () => new Date(),
        frontendUrl: FRONTEND_URL,
    };
    return crearInvitacionPlataforma(deps, { organizationId, email, rol: 'ADMIN' });
});
function buildTenantsDeps() {
    return { repo: tenantsRepoPrisma, crearInvitacionAdmin, now: () => new Date() };
}
// ─── Salida ──────────────────────────────────────────────────────────────────
// Hostnames que identifican una máquina local sin importar el esquema o el
// puerto. Antes se buscaba la subcadena "localhost" en FRONTEND_URL entero,
// lo que además de no cubrir 127.0.0.1/::1 podía dar un falso positivo con un
// dominio real que solo contuviera esa palabra (p. ej. un subdominio de
// preview). Comparar por hostname exacto evita ambos problemas.
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
function esFrontendUrlLocal(url) {
    let hostname;
    try {
        hostname = new URL(url).hostname;
    }
    catch {
        // FRONTEND_URL ya pasó por resolveFrontendUrl (lib/config.ts), que lanza
        // en el arranque si no es una URL http(s) válida — esto nunca debería
        // alcanzarse, pero de ser así no hay hostname que advertir.
        return false;
    }
    // El hostname de una URL IPv6 conserva los corchetes ("[::1]"); se
    // normaliza para comparar contra el set de arriba.
    return LOCALHOST_HOSTNAMES.has(hostname.replace(/^\[|\]$/g, ''));
}
function advertirSiFrontendLocal() {
    if (esFrontendUrlLocal(FRONTEND_URL)) {
        console.log('[tenant] ADVERTENCIA: FRONTEND_URL apunta a localhost — no envíes este enlace a un administrador real.');
    }
}
const COLUMNAS_LISTADO = [
    { header: 'slug', value: (r) => r.slug },
    { header: 'nombre', value: (r) => r.name },
    { header: 'estado', value: (r) => r.status },
    { header: 'membresía propia', value: (r) => r.membresiaPropia },
    { header: 'usuarios', value: (r) => String(r.userCount) },
    { header: 'invitaciones pendientes', value: (r) => String(r.pendingInvitationCount) },
    { header: 'creado', value: (r) => r.createdAt.toISOString().slice(0, 10) },
];
function printTable(rows) {
    if (rows.length === 0) {
        console.log('[tenant] No hay clubes.');
        return;
    }
    const widths = COLUMNAS_LISTADO.map((col) => Math.max(col.header.length, ...rows.map((row) => col.value(row).length)));
    const printRow = (cells) => {
        console.log(cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  '));
    };
    printRow(COLUMNAS_LISTADO.map((col) => col.header));
    printRow(widths.map((w) => '-'.repeat(w)));
    for (const row of rows) {
        printRow(COLUMNAS_LISTADO.map((col) => col.value(row)));
    }
}
// ─── Subcomandos ────────────────────────────────────────────────────────────────
async function runCreate(deps, data) {
    const input = {
        slug: data.slug,
        name: data.name,
        shortName: data.shortName,
        membresiaPropia: data.membresia,
        alertEmail: data.alertEmail,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        adminEmail: data.adminEmail,
    };
    const result = await crearClub(deps, input);
    if (!result.ok) {
        console.error(`[tenant] No se pudo crear el club: ${result.error}`);
        process.exitCode = 1;
        return;
    }
    const { organization, categoriasCreadas, declaracion, invitacion } = result.body;
    console.log(`[tenant] Club creado: slug="${organization.slug}" name="${organization.name}"`);
    console.log(`[tenant] Categorías creadas: ${categoriasCreadas}`);
    console.log(`[tenant] Declaración jurada vigente: versión "${declaracion.version}"`);
    if (!invitacion.emitida) {
        console.error(`[tenant] ADVERTENCIA: el club quedó creado, pero no se pudo emitir la invitación del primer ADMIN: ${invitacion.error}`);
        console.error(`[tenant] Ejecuta: ${invitacion.comandoRecuperacion}`);
        process.exitCode = 1;
        return;
    }
    console.log(`[tenant] Correo enviado: ${invitacion.emailEnviado ? 'sí' : 'no'} (destinatario: ${data.adminEmail})`);
    // FRONTEND_URL y su advertencia van justo antes del enlace, nunca lejos de
    // él: es la única forma de que un operador distraído no se salte la
    // advertencia y termine mandando un link roto o local a un administrador real.
    console.log(`[tenant] FRONTEND_URL usado: ${FRONTEND_URL}`);
    advertirSiFrontendLocal();
    console.log('[tenant] Enlace de invitación del primer ADMIN (un solo uso, expira en 7 días):');
    console.log(`  ${invitacion.inviteUrl}`);
}
async function runList(deps) {
    const clubes = await listarClubes(deps);
    printTable(clubes);
}
async function runCambiarEstado(deps, slug, nuevoEstado) {
    const result = await cambiarEstadoClub(deps, slug, nuevoEstado);
    if (!result.ok) {
        console.error(`[tenant] ${result.error}`);
        process.exitCode = 1;
        return;
    }
    const { estadoAnterior, estadoNuevo, sinCambios } = result.body;
    if (sinCambios) {
        console.log(`[tenant] El club "${slug}" ya estaba en estado ${estadoNuevo}; no hubo cambios.`);
        return;
    }
    console.log(`[tenant] Club "${slug}": ${estadoAnterior} → ${estadoNuevo}`);
    if (estadoNuevo === 'SUSPENDED') {
        console.log('[tenant] El login y toda request autenticada de este club responderán 403 mientras esté suspendido.');
        console.log('[tenant] Las alertas de seguridad ("salida sin cierre") de sus salidas abiertas seguirán enviándose con normalidad.');
    }
}
async function runInvite(deps, slug, adminEmail) {
    const result = await invitarAdminClub(deps, slug, adminEmail);
    if (!result.ok) {
        console.error(`[tenant] No se pudo emitir la invitación: ${result.error}`);
        process.exitCode = 1;
        return;
    }
    console.log(`[tenant] Invitación reemitida para "${adminEmail}" en el club "${slug}".`);
    console.log('[tenant] Nota: la invitación pendiente anterior para ese correo queda revocada automáticamente.');
    console.log(`[tenant] Correo enviado: ${result.body.emailEnviado ? 'sí' : 'no'}`);
    // Ver el comentario equivalente en runCreate: FRONTEND_URL y su advertencia
    // van justo antes del enlace, nunca después.
    console.log(`[tenant] FRONTEND_URL usado: ${FRONTEND_URL}`);
    advertirSiFrontendLocal();
    console.log('[tenant] Enlace de invitación (un solo uso, expira en 7 días):');
    console.log(`  ${result.body.inviteUrl}`);
}
const ETIQUETAS_CAMPO = {
    name: 'Nombre',
    shortName: 'Nombre corto',
    contactName: 'Nombre de contacto',
    contactEmail: 'Email de contacto',
    alertEmail: 'Email de alerta',
};
function formatValorCampo(valor) {
    return valor === null ? '(sin nombre corto)' : valor;
}
async function runUpdate(deps, data) {
    const input = {
        name: data.name,
        shortName: data.shortName,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        alertEmail: data.alertEmail,
    };
    const result = await actualizarClub(deps, data.slug, input);
    if (!result.ok) {
        console.error(`[tenant] No se pudo actualizar el club: ${result.error}`);
        process.exitCode = 1;
        return;
    }
    const { cambios, sinCambios } = result.body;
    if (sinCambios) {
        console.log(`[tenant] El club "${data.slug}" ya tenía esos valores; no hubo cambios.`);
        return;
    }
    console.log(`[tenant] Club "${data.slug}" actualizado:`);
    for (const cambio of cambios) {
        console.log(`  ${ETIQUETAS_CAMPO[cambio.campo]}: ${formatValorCampo(cambio.antes)} → ${formatValorCampo(cambio.despues)}`);
    }
    // El email de alerta es el destino de la alarma de seguridad "salida sin
    // cierre" (lib/alert-recipient.ts, consumida por cron.controller.ts) y este
    // comando no tiene ningún paso de verificación sobre él: un typo redirige
    // la alarma en silencio, sin que nadie se entere hasta que haga falta.
    if (cambios.some((cambio) => cambio.campo === 'alertEmail')) {
        console.log('[tenant] ADVERTENCIA: cambiaste el email de alerta de seguridad ("salida sin cierre"). No hay paso de ' +
            'verificación — revisa que esté bien escrito, un typo aquí redirige la alarma en silencio.');
    }
}
// ─── Orquestación ──────────────────────────────────────────────────────────────
function main() {
    return runAsPlatform(run);
}
async function run() {
    verifyDbTargetOrExit();
    const parsed = parseTenantArgs(process.argv.slice(2));
    if (!parsed.success) {
        for (const error of parsed.errors) {
            console.error(`[tenant] ${error}`);
        }
        process.exitCode = 1;
        return;
    }
    const deps = buildTenantsDeps();
    switch (parsed.data.command) {
        case 'create':
            await runCreate(deps, parsed.data);
            return;
        case 'list':
            await runList(deps);
            return;
        case 'suspend':
            await runCambiarEstado(deps, parsed.data.slug, 'SUSPENDED');
            return;
        case 'activate':
            await runCambiarEstado(deps, parsed.data.slug, 'ACTIVE');
            return;
        case 'invite':
            await runInvite(deps, parsed.data.slug, parsed.data.adminEmail);
            return;
        case 'update':
            await runUpdate(deps, parsed.data);
            return;
    }
}
main()
    .catch((error) => {
    console.error('[tenant] Error inesperado:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma.$disconnect();
});
