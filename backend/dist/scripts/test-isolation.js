// Suite de aislamiento multi-club de extremo a extremo. Corre contra la base
// de datos REAL de desarrollo (protegida por db:guard — ver package.json) y
// debe dejarla exactamente como la encontró. No se ejecuta como parte de
// `npm test` (usa `npm run test:isolation`): abre conexiones reales y levanta
// un servidor HTTP efímero.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { verifyDbTargetOrExit } from '../lib/db-target-guard.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { signToken } from '../lib/jwt.js';
import { crearInvitacionPlataforma } from '../services/invitaciones.service.js';
import { invitacionesRepoPrisma } from '../services/invitaciones.repo.prisma.js';
import { solicitarInvitacionQr as solicitarInvitacionQrService, MENSAJE_SOLICITUD_GENERICA, } from '../services/codigos-qr.service.js';
import { codigosQrRepoPrisma } from '../services/codigos-qr.repo.prisma.js';
import { generateInviteToken } from '../lib/invitaciones.js';
import { cifrarTokenQr } from '../lib/codigos-qr.js';
import { SALT_ROUNDS } from '../lib/auth-fields.js';
import { requireJwtSecret } from '../lib/jwt.js';
import { isOrganizationSuspended } from '../lib/organization-status.js';
import { toPublicOrganizationBrand } from '../lib/serializers/organization.js';
import { crearClub, listarClubes, cambiarEstadoClub, invitarAdminClub, } from '../services/tenants.service.js';
import { tenantsRepoPrisma } from '../services/tenants.repo.prisma.js';
import { computeDeclaracionHash } from '../lib/tenant-defaults.js';
import { getFileStorage } from '../lib/storage/get-file-storage.js';
import { buildObjectKey } from '../lib/storage/object-key.js';
import app from '../app.js';
const asJson = (v) => v;
// ─── Claves naturales COLISIONANTES entre ambos clubes (a propósito) ──────────
const SHARED_RUT = '11.111.111-1';
const SHARED_CATEGORIA_SLUG = 'iso-test-categoria';
const SHARED_DECLARACION_VERSION = 'iso-test-v1';
const SHARED_NUMERO_SALIDA = 1;
// RUT del socio "de biblioteca" (distinto del SHARED_RUT de arriba, que ya
// usan las pruebas genéricas por modelo) — ver seedOrganization.
const SOCIO_RUT = '22.222.222-2';
// Membresías propias reales de ambos clubes (no un valor sintético
// "SOCIO_ISO_X"): el check de la biblioteca de documentos depende de que
// difieran entre sí para poder probar la regla "misma afiliación, club
// distinto".
const MEMBRESIA_A = 'SOCIO_ANDINO_PAMIR';
const MEMBRESIA_B = 'SOCIO_EL_MONTANISTA';
const RANDOM_SUFFIX = randomUUID().slice(0, 8);
const SLUG_A = `iso-test-a-${RANDOM_SUFFIX}`;
const SLUG_B = `iso-test-b-${RANDOM_SUFFIX}`;
const results = [];
async function check(label, fn) {
    try {
        await fn();
        results.push({ label, ok: true });
    }
    catch (err) {
        results.push({ label, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
}
function printReport() {
    console.log('\n[test-isolation] Reporte:');
    for (const r of results) {
        const mark = r.ok ? '✓' : '✗';
        console.log(`  ${mark} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    const fails = results.filter((r) => !r.ok).length;
    console.log(`\n[test-isolation] ${results.length - fails}/${results.length} verificaciones pasaron.`);
}
// ─── Limpieza (arranque en frío y cierre) ─────────────────────────────────────
// Borra TODAS las filas de un club, en orden seguro para las FK, y por último
// el club mismo. Corre en contexto de plataforma: no hay ningún club "actual"
// desde el que limpiar otro.
async function purgeOrganization(organizationId) {
    await runAsPlatform(async () => {
        await prisma.notificacion.deleteMany({ where: { organizationId } });
        await prisma.inscripcion.deleteMany({ where: { organizationId } });
        await prisma.gestorCategoria.deleteMany({ where: { organizationId } });
        await prisma.evento.deleteMany({ where: { organizationId } });
        await prisma.categoriaEvento.deleteMany({ where: { organizationId } });
        await prisma.declaracionJuradaVersion.deleteMany({ where: { organizationId } });
        await prisma.evaluacionRespuesta.deleteMany({ where: { organizationId } });
        await prisma.evaluacionToken.deleteMany({ where: { organizationId } });
        await prisma.cierre.deleteMany({ where: { organizationId } });
        await prisma.salida.deleteMany({ where: { organizationId } });
        await prisma.documento.deleteMany({ where: { organizationId } });
        await prisma.integrante.deleteMany({ where: { organizationId } });
        // Antes de invitaciones/organización: CodigoQrInvitacion referencia a
        // Organization con onDelete Restrict (como el resto de los modelos de
        // tenant), aunque Invitacion.codigoQrId apunta a ella con SetNull.
        await prisma.codigoQrInvitacion.deleteMany({ where: { organizationId } });
        await prisma.invitacion.deleteMany({ where: { organizationId } });
        await prisma.dashboardLayout.deleteMany({ where: { organizationId } });
        await prisma.user.deleteMany({ where: { organizationId } });
        await prisma.organization.delete({ where: { id: organizationId } });
    });
}
// Borra cualquier organización "iso-test-*" que haya quedado de una corrida
// anterior (crash) o de la corrida actual. Devuelve cuántas purgó.
async function purgeAllIsoTestOrganizations() {
    const orgs = await runAsPlatform(() => prisma.organization.findMany({ where: { slug: { startsWith: 'iso-test-' } }, select: { id: true } }));
    for (const org of orgs) {
        await purgeOrganization(org.id);
    }
    return orgs.length;
}
async function countIsoTestOrganizations() {
    return runAsPlatform(() => prisma.organization.count({ where: { slug: { startsWith: 'iso-test-' } } }));
}
// Una fila de cada uno de los 15 modelos de tenant, con claves naturales
// COLISIONANTES entre A y B a propósito (mismo rut, slug, versión y
// numeroSalida) — si el aislamiento tuviera un agujero, esto lo expondría.
async function seedOrganization(label, slug) {
    return runAsPlatform(async () => {
        const membresiaPropia = label === 'A' ? MEMBRESIA_A : MEMBRESIA_B;
        const organizationName = `Iso Test Club ${label}`;
        const organization = await prisma.organization.create({
            data: {
                slug,
                name: organizationName,
                membresiaPropia,
                alertEmail: `alert-${label.toLowerCase()}-${RANDOM_SUFFIX}@iso-test.local`,
                contactName: `Contacto ${label}`,
                contactEmail: `contacto-${label.toLowerCase()}-${RANDOM_SUFFIX}@iso-test.local`,
            },
        });
        const adminEmail = `admin-${label.toLowerCase()}-${RANDOM_SUFFIX}@iso-test.local`;
        const adminUser = await prisma.user.create({
            data: {
                organizationId: organization.id,
                email: adminEmail,
                name: `Admin ${label}`,
                rol: 'ADMIN',
                emailVerified: true,
            },
        });
        const integrante = await prisma.integrante.create({
            data: {
                organizationId: organization.id,
                nombreCompleto: `Integrante ${label}`,
                rut: SHARED_RUT,
                nacionalidad: 'Chilena',
                genero: 'OTRO',
                fechaNacimiento: new Date('1990-01-01T00:00:00.000Z'),
                direccion: 'Calle Falsa 123',
                comuna: 'Santiago',
                region: 'Metropolitana',
                telefonoCelular: '+56900000000',
                email: `integrante-${label.toLowerCase()}-${RANDOM_SUFFIX}@iso-test.local`,
                previsionSalud: 'FONASA',
                nombreContacto: 'Contacto Emergencia',
                parentesco: 'Padre',
                telefonoContacto: '+56900000001',
                grupoSanguineo: 'O+',
                alergiasTiene: false,
                enfermedadesCronicasTiene: false,
                medicamentosTiene: false,
                cirugiasLesionesTiene: false,
                fuma: false,
                usaLentes: false,
                membresiaClub: membresiaPropia,
                declaracionSalud: true,
                aceptacionRiesgo: true,
                consentimientoDatos: true,
                derechoImagen: true,
            },
        });
        // Socio (no admin) con una ficha de Integrante EN SU PROPIO club cuya
        // membresía es siempre la de A, incluso en el seed de B — así el check de
        // la biblioteca de documentos comprueba que la regla depende de la
        // membresía propia del club QUE CONSULTA, no de a qué club "dice
        // pertenecer" el socio (misma afiliación, resultado distinto).
        const socioEmail = `socio-${label.toLowerCase()}-${RANDOM_SUFFIX}@iso-test.local`;
        const socioUser = await prisma.user.create({
            data: {
                organizationId: organization.id,
                email: socioEmail,
                name: `Socio ${label}`,
                rol: 'SOCIO',
                emailVerified: true,
            },
        });
        await prisma.integrante.create({
            data: {
                organizationId: organization.id,
                nombreCompleto: `Socio Integrante ${label}`,
                rut: SOCIO_RUT,
                nacionalidad: 'Chilena',
                genero: 'OTRO',
                fechaNacimiento: new Date('1990-01-01T00:00:00.000Z'),
                direccion: 'Calle Falsa 456',
                comuna: 'Santiago',
                region: 'Metropolitana',
                telefonoCelular: '+56900000002',
                email: socioEmail,
                previsionSalud: 'FONASA',
                nombreContacto: 'Contacto Emergencia',
                parentesco: 'Madre',
                telefonoContacto: '+56900000003',
                grupoSanguineo: 'O+',
                alergiasTiene: false,
                enfermedadesCronicasTiene: false,
                medicamentosTiene: false,
                cirugiasLesionesTiene: false,
                fuma: false,
                usaLentes: false,
                membresiaClub: MEMBRESIA_A,
                declaracionSalud: true,
                aceptacionRiesgo: true,
                consentimientoDatos: true,
                derechoImagen: true,
            },
        });
        const categoriaEvento = await prisma.categoriaEvento.create({
            data: {
                organizationId: organization.id,
                slug: SHARED_CATEGORIA_SLUG,
                nombre: `Categoría ${label}`,
                color: '#123456',
                orden: 1,
            },
        });
        const gestorCategoria = await prisma.gestorCategoria.create({
            data: {
                organizationId: organization.id,
                usuarioId: adminUser.id,
                categoriaId: categoriaEvento.id,
            },
        });
        const declaracionVersion = await prisma.declaracionJuradaVersion.create({
            data: {
                organizationId: organization.id,
                version: SHARED_DECLARACION_VERSION,
                titulo: `Declaración ${label}`,
                items: asJson(['item-1', 'item-2']),
                hashSha256: randomUUID().replace(/-/g, ''),
            },
        });
        const ahora = new Date();
        const salida = await prisma.salida.create({
            data: {
                organizationId: organization.id,
                numeroSalida: SHARED_NUMERO_SALIDA,
                userId: adminUser.id,
                creatorEmail: adminEmail,
                tipoSalida: 'CLUB',
                disciplina: 'MONTANISMO',
                nombreActividad: `Salida iso-test ${label}`,
                ubicacionGeografica: 'Cordillera',
                fechaInicio: ahora,
                fechaRetornoEstimada: ahora,
                horaRetornoEstimada: '18:00',
                horaAlerta: '20:00',
                liderCordada: `Lider ${label}`,
                esRegistroHistorico: false,
            },
        });
        const cierre = await prisma.cierre.create({
            data: {
                organizationId: organization.id,
                salidaId: salida.id,
                userId: adminUser.id,
                fechaFinalizacionReal: ahora,
                estadoCierre: 'EXITOSA',
                huboCambios: 'NO',
                ocurrioIncidente: 'NO',
                desempenoEquipo: 'BUENO',
                observacionesRuta: 'Sin novedad',
                precisionPronostico: 5,
                leccionesAprendidas: 'Ninguna',
            },
        });
        const evaluacionToken = await prisma.evaluacionToken.create({
            data: {
                organizationId: organization.id,
                token: `iso-test-eval-${label.toLowerCase()}-${RANDOM_SUFFIX}`,
                salidaId: salida.id,
                email: adminEmail,
            },
        });
        const evaluacionRespuesta = await prisma.evaluacionRespuesta.create({
            data: {
                organizationId: organization.id,
                salidaId: salida.id,
                notaObjetivos: 5,
                notaItinerario: 5,
                notaLider: 5,
            },
        });
        const documento = await prisma.documento.create({
            data: {
                organizationId: organization.id,
                categoria: 'OTRO',
                nombre: `Documento ${label}`,
            },
        });
        // Sin fechaInicio/fechaFin: como BORRADOR, la ventana temporal de
        // GET /api/eventos igual lo incluye para el admin (ver getEventos).
        const evento = await prisma.evento.create({
            data: {
                organizationId: organization.id,
                titulo: `Evento iso-test ${label}`,
                categoriaId: categoriaEvento.id,
                creadoPor: adminUser.id,
            },
        });
        const inscripcion = await prisma.inscripcion.create({
            data: {
                organizationId: organization.id,
                eventoId: evento.id,
                usuarioId: adminUser.id,
                tieneVehiculo: false,
                declaracionVersionId: declaracionVersion.id,
                declaracionAceptadaAt: ahora,
            },
        });
        const notificacion = await prisma.notificacion.create({
            data: {
                organizationId: organization.id,
                inscripcionId: inscripcion.id,
                tipo: 'INSCRIPCION_CONFIRMADA',
            },
        });
        const dashboardLayout = await prisma.dashboardLayout.create({
            data: { organizationId: organization.id, userId: adminUser.id },
        });
        const invitacion = await prisma.invitacion.create({
            data: {
                organizationId: organization.id,
                email: `invitado-${label.toLowerCase()}-${RANDOM_SUFFIX}@iso-test.local`,
                tokenHash: randomUUID().replace(/-/g, ''),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                invitadoPorId: adminUser.id,
            },
        });
        return {
            organizationId: organization.id,
            organizationName,
            adminUserId: adminUser.id,
            adminEmail,
            socioUserId: socioUser.id,
            socioEmail,
            integranteId: integrante.id,
            categoriaEventoId: categoriaEvento.id,
            gestorCategoriaId: gestorCategoria.id,
            declaracionVersionId: declaracionVersion.id,
            salidaId: salida.id,
            cierreId: cierre.id,
            evaluacionTokenId: evaluacionToken.id,
            evaluacionRespuestaId: evaluacionRespuesta.id,
            documentoId: documento.id,
            eventoId: evento.id,
            inscripcionId: inscripcion.id,
            notificacionId: notificacion.id,
            dashboardLayoutId: dashboardLayout.id,
            invitacionId: invitacion.id,
        };
    });
}
function asCheckable(delegate) {
    return delegate;
}
function buildProbes(seedA, seedB) {
    return [
        {
            name: 'User',
            delegate: asCheckable(prisma.user),
            idA: seedA.adminUserId,
            idB: seedB.adminUserId,
            updateProbe: { name: 'probe' },
            rowCount: 2,
        },
        {
            name: 'DashboardLayout',
            delegate: asCheckable(prisma.dashboardLayout),
            idA: seedA.dashboardLayoutId,
            idB: seedB.dashboardLayoutId,
            updateProbe: { layout: [] },
        },
        {
            name: 'Invitacion',
            delegate: asCheckable(prisma.invitacion),
            idA: seedA.invitacionId,
            idB: seedB.invitacionId,
            updateProbe: { revocadaAt: null },
        },
        { name: 'Salida', delegate: asCheckable(prisma.salida), idA: seedA.salidaId, idB: seedB.salidaId, updateProbe: { horaAlerta: '20:00' } },
        {
            name: 'EvaluacionToken',
            delegate: asCheckable(prisma.evaluacionToken),
            idA: seedA.evaluacionTokenId,
            idB: seedB.evaluacionTokenId,
            updateProbe: { used: false },
        },
        {
            name: 'EvaluacionRespuesta',
            delegate: asCheckable(prisma.evaluacionRespuesta),
            idA: seedA.evaluacionRespuestaId,
            idB: seedB.evaluacionRespuestaId,
            updateProbe: { comentario: 'probe' },
        },
        { name: 'Cierre', delegate: asCheckable(prisma.cierre), idA: seedA.cierreId, idB: seedB.cierreId, updateProbe: { altitudMaxima: 0 } },
        {
            name: 'Documento',
            delegate: asCheckable(prisma.documento),
            idA: seedA.documentoId,
            idB: seedB.documentoId,
            updateProbe: { visible: true },
        },
        {
            name: 'Integrante',
            delegate: asCheckable(prisma.integrante),
            idA: seedA.integranteId,
            idB: seedB.integranteId,
            updateProbe: { fuma: false },
            rowCount: 2,
        },
        {
            name: 'CategoriaEvento',
            delegate: asCheckable(prisma.categoriaEvento),
            idA: seedA.categoriaEventoId,
            idB: seedB.categoriaEventoId,
            updateProbe: { activa: true },
        },
        {
            name: 'GestorCategoria',
            delegate: asCheckable(prisma.gestorCategoria),
            idA: seedA.gestorCategoriaId,
            idB: seedB.gestorCategoriaId,
            updateProbe: { creadoAt: new Date() },
        },
        {
            name: 'DeclaracionJuradaVersion',
            delegate: asCheckable(prisma.declaracionJuradaVersion),
            idA: seedA.declaracionVersionId,
            idB: seedB.declaracionVersionId,
            updateProbe: { titulo: 'probe' },
        },
        { name: 'Evento', delegate: asCheckable(prisma.evento), idA: seedA.eventoId, idB: seedB.eventoId, updateProbe: { titulo: 'probe' } },
        {
            name: 'Inscripcion',
            delegate: asCheckable(prisma.inscripcion),
            idA: seedA.inscripcionId,
            idB: seedB.inscripcionId,
            updateProbe: { tieneVehiculo: false },
        },
        {
            name: 'Notificacion',
            delegate: asCheckable(prisma.notificacion),
            idA: seedA.notificacionId,
            idB: seedB.notificacionId,
            updateProbe: { intentos: 0 },
        },
    ];
}
async function runProbeChecks(probe, orgAId, orgBId) {
    const { name, delegate, idA, idB, updateProbe, rowCount = 1 } = probe;
    await check(`${name}.findMany bajo A solo devuelve fila(s) de A`, async () => {
        const rows = await runWithOrganization(orgAId, () => delegate.findMany({ where: {} }));
        assert.equal(rows.length, rowCount);
        assert.ok(rows.some((r) => r.id === idA));
    });
    await check(`${name}.findUnique por el id de B bajo A es null`, async () => {
        const row = await runWithOrganization(orgAId, () => delegate.findUnique({ where: { id: idB } }));
        assert.equal(row, null);
    });
    await check(`${name}.findFirst por el id de B bajo A es null`, async () => {
        const row = await runWithOrganization(orgAId, () => delegate.findFirst({ where: { id: idB } }));
        assert.equal(row, null);
    });
    await check(`${name}.count bajo A solo cuenta fila(s) de A`, async () => {
        const total = await runWithOrganization(orgAId, () => delegate.count({ where: {} }));
        assert.equal(total, rowCount);
    });
    await check(`${name}.update por el id de B bajo A lanza y no toca la fila de B`, async () => {
        await assert.rejects(() => runWithOrganization(orgAId, () => delegate.update({ where: { id: idB }, data: updateProbe })));
        const stillThere = await runAsPlatform(() => delegate.findUnique({ where: { id: idB } }));
        assert.notEqual(stillThere, null);
    });
    await check(`${name}.delete por el id de B bajo A lanza y la fila de B sigue existiendo`, async () => {
        await assert.rejects(() => runWithOrganization(orgAId, () => delegate.delete({ where: { id: idB } })));
        const stillThere = await runAsPlatform(() => delegate.findUnique({ where: { id: idB } }));
        assert.notEqual(stillThere, null);
    });
    await check(`${name}.updateMany filtrado por el id de B bajo A afecta 0 filas`, async () => {
        const result = await runWithOrganization(orgAId, () => delegate.updateMany({ where: { id: idB }, data: updateProbe }));
        assert.equal(result.count, 0);
    });
    await check(`${name}.deleteMany filtrado por el id de B bajo A afecta 0 filas`, async () => {
        const result = await runWithOrganization(orgAId, () => delegate.deleteMany({ where: { id: idB } }));
        assert.equal(result.count, 0);
    });
    await check(`${name}.create con organizationId de B bajo el contexto de A lanza`, async () => {
        await assert.rejects(() => runWithOrganization(orgAId, () => delegate.create({ data: { organizationId: orgBId } })));
    });
}
// ─── Verificaciones transversales (transacciones, Organization, clave compuesta) ─
async function runCrossCuttingChecks(seedA, seedB) {
    await check('una consulta sin ningún contexto de tenant lanza', async () => {
        await assert.rejects(() => prisma.salida.findMany());
    });
    await check('transacción interactiva bajo A: tx.salida solo ve las filas de A', async () => {
        await runWithOrganization(seedA.organizationId, () => prisma.$transaction(async (tx) => {
            const rows = await tx.salida.findMany({});
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.id, seedA.salidaId);
            const other = await tx.salida.findUnique({ where: { id: seedB.salidaId } });
            assert.equal(other, null);
        }));
    });
    await check('transacción en arreglo bajo A cuenta solo las filas de A', async () => {
        await runWithOrganization(seedA.organizationId, async () => {
            const [salidaCount, integranteCount] = await prisma.$transaction([prisma.salida.count(), prisma.integrante.count()]);
            assert.equal(salidaCount, 1);
            // 2: el Integrante "genérico" (SHARED_RUT) más el socio "de biblioteca"
            // (SOCIO_RUT) — ver seedOrganization.
            assert.equal(integranteCount, 2);
        });
    });
    await check('Organization.findMany bajo A solo ve a A; pedir el id de B lanza error', async () => {
        await runWithOrganization(seedA.organizationId, async () => {
            const orgs = await prisma.organization.findMany({});
            assert.equal(orgs.length, 1);
            assert.equal(orgs[0]?.id, seedA.organizationId);
            // Organization es auto-acotada: pedir explícitamente el id de OTRO club no
            // devuelve null, lanza. Ningún flujo legítimo hace esa consulta, así que
            // se prefiere un fallo ruidoso a un null que esconda el bug.
            await assert.rejects(async () => prisma.organization.findUnique({ where: { id: seedB.organizationId } }), { name: 'TenantContextError' });
            const own = await prisma.organization.findUnique({ where: { id: seedA.organizationId } });
            assert.equal(own?.id, seedA.organizationId);
        });
    });
    await check('runAsPlatform ve ambos clubes', async () => {
        const orgs = await runAsPlatform(() => prisma.organization.findMany({
            where: { id: { in: [seedA.organizationId, seedB.organizationId] } },
        }));
        assert.equal(orgs.length, 2);
    });
    await check('Integrante.findUnique por clave compuesta (organizationId_rut) bajo A devuelve el integrante de A pese al RUT compartido', async () => {
        const integrante = await runWithOrganization(seedA.organizationId, () => prisma.integrante.findUnique({
            where: { organizationId_rut: { organizationId: seedA.organizationId, rut: SHARED_RUT } },
        }));
        assert.ok(integrante);
        assert.equal(integrante?.id, seedA.integranteId);
    });
}
// ─── Verificaciones HTTP ───────────────────────────────────────────────────────
async function startServer() {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, () => {
            const address = server.address();
            if (!address) {
                reject(new Error('No se pudo determinar el puerto del servidor de pruebas'));
                return;
            }
            resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
        });
        server.on('error', reject);
    });
}
async function stopServer(server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
}
async function getJson(baseUrl, token, urlPath) {
    const res = await fetch(`${baseUrl}${urlPath}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => undefined);
    return { status: res.status, body };
}
// Como getJson, pero también expone los headers de respuesta — lo necesitan
// los checks de Cache-Control de las URLs firmadas (ver runFileDownloadChecks).
async function getRaw(baseUrl, token, urlPath) {
    const res = await fetch(`${baseUrl}${urlPath}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => undefined);
    return { status: res.status, body, headers: res.headers };
}
async function deleteJson(baseUrl, token, urlPath) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status };
}
// Sin token: usado por los dos endpoints públicos de invitaciones
// (/api/auth/invitaciones/consultar y /aceptar). Ninguno de los dos envía
// correo ni sube archivos.
async function postJson(baseUrl, urlPath, payload) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => undefined);
    return { status: res.status, body };
}
// Como postJson, pero autenticado — lo necesita la sección del CLI de clubes
// (ver runTenantCliChecks) para crear/publicar un evento y para invitar a un
// SOCIO, ninguno de los cuales es público.
async function postJsonAuth(baseUrl, token, urlPath, payload) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => undefined);
    return { status: res.status, body };
}
// Fecha calendario (YYYY-MM-DD) desplazada `dias` desde ahora — usada para
// armar la ficha del evento operativo del club nuevo (ver runTenantCliChecks)
// sin acoplarse a la fecha en que corra la suite.
function fechaEnDias(dias) {
    return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
async function runHttpChecks(baseUrl, seedA, seedB) {
    const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
    const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });
    await check('GET /api/salidas — cada admin ve solo la salida de su propio club', async () => {
        const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, '/api/salidas'), getJson(baseUrl, tokenB, '/api/salidas')]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);
        const salidasA = resA.body;
        const salidasB = resB.body;
        assert.equal(salidasA.length, 1);
        assert.equal(salidasA[0]?.id, seedA.salidaId);
        assert.equal(salidasB.length, 1);
        assert.equal(salidasB[0]?.id, seedB.salidaId);
    });
    await check('GET /api/salidas/<id de otro club> devuelve 404', async () => {
        const res = await getJson(baseUrl, tokenA, `/api/salidas/${seedB.salidaId}`);
        assert.equal(res.status, 404);
    });
    await check('GET /api/me — cada admin ve la organización pública de SU PROPIO club (7 campos, sin datos privados)', async () => {
        const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, '/api/me'), getJson(baseUrl, tokenB, '/api/me')]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);
        const orgA = resA.body.user.organization;
        const orgB = resB.body.user.organization;
        assert.ok(orgA);
        assert.ok(orgB);
        // Igualdad estricta a propósito: si algún día se filtra alertEmail,
        // contactEmail o la clave cruda del logo (logoObjectKey), esto falla.
        assert.deepEqual(Object.keys(orgA).sort(), [
            'hasLogo', 'id', 'logoVersion', 'membresiaPropia', 'name', 'shortName', 'slug',
        ]);
        // Ningún club de este fixture subió un logo propio.
        assert.equal(orgA.hasLogo, false);
        assert.equal(orgA.logoVersion, null);
        assert.equal(orgA.slug, SLUG_A);
        assert.equal(orgA.membresiaPropia, MEMBRESIA_A);
        assert.equal(orgB.slug, SLUG_B);
        assert.equal(orgB.membresiaPropia, MEMBRESIA_B);
        assert.notEqual(orgA.id, orgB.id);
    });
    await check('GET /api/admin/users — solo los usuarios del propio club', async () => {
        const res = await getJson(baseUrl, tokenA, '/api/admin/users');
        assert.equal(res.status, 200);
        const users = res.body;
        // 2: el admin y el socio "de biblioteca" seedeados en el club A.
        assert.equal(users.length, 2);
        const emails = users.map((u) => u.email);
        assert.ok(emails.includes(seedA.adminEmail));
        assert.ok(emails.includes(seedA.socioEmail));
    });
    await check('GET /api/admin/stats — los totales reflejan solo el club del que consulta (predicado SQL crudo)', async () => {
        const res = await getJson(baseUrl, tokenA, '/api/admin/stats');
        assert.equal(res.status, 200);
        const stats = res.body;
        assert.equal(stats.totalSalidas, 1);
        const sumaPorMes = stats.porMes.reduce((acc, r) => acc + r.total, 0);
        assert.equal(sumaPorMes, 1);
    });
    await check('GET /api/invitaciones — solo las propias', async () => {
        const res = await getJson(baseUrl, tokenA, '/api/invitaciones');
        assert.equal(res.status, 200);
        const body = res.body;
        assert.equal(body.invitaciones.length, 1);
        assert.equal(body.invitaciones[0]?.id, seedA.invitacionId);
    });
    await check('GET /api/documentos/admin — solo los propios', async () => {
        const res = await getJson(baseUrl, tokenA, '/api/documentos/admin');
        assert.equal(res.status, 200);
        const documentos = res.body;
        assert.equal(documentos.length, 1);
        assert.equal(documentos[0]?.id, seedA.documentoId);
    });
    await check('GET /api/eventos — solo los propios', async () => {
        const res = await getJson(baseUrl, tokenA, '/api/eventos');
        assert.equal(res.status, 200);
        const eventos = res.body;
        assert.equal(eventos.length, 1);
        assert.equal(eventos[0]?.id, seedA.eventoId);
    });
    await check('GET /api/integrantes/by-rut/<rut compartido> — cada club obtiene SU PROPIO integrante', async () => {
        const path = `/api/integrantes/by-rut/${encodeURIComponent(SHARED_RUT)}`;
        const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, path), getJson(baseUrl, tokenB, path)]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);
        const integranteA = resA.body;
        const integranteB = resB.body;
        assert.notEqual(integranteA.email, integranteB.email);
    });
    const tokenSocioA = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
    const tokenSocioB = signToken({ userId: seedB.socioUserId, email: seedB.socioEmail });
    await check('GET /api/documentos — el socio de A (membresía propia de A) ve la biblioteca', async () => {
        const res = await getJson(baseUrl, tokenSocioA, '/api/documentos');
        assert.equal(res.status, 200);
    });
    await check('GET /api/documentos — el socio de B con la MISMA afiliación (membresía de A) recibe 403 nombrando a SU club', async () => {
        const res = await getJson(baseUrl, tokenSocioB, '/api/documentos');
        assert.equal(res.status, 403);
        const body = res.body;
        assert.match(body.error, new RegExp(seedB.organizationName));
    });
    // ─── Marca pública en pantallas sin sesión (branding por club) ────────────────
    await check('POST /api/auth/invitaciones/consultar expone la marca del club que invita (slug/name/shortName, nunca datos privados)', async () => {
        const email = `consultar-brand-${RANDOM_SUFFIX}@iso-test.local`;
        const creada = await postJsonAuth(baseUrl, tokenA, '/api/invitaciones', { email, rol: 'SOCIO' });
        assert.equal(creada.status, 201);
        const inviteUrl = creada.body.inviteUrl;
        const token = inviteUrl.split('#invite=')[1] ?? '';
        assert.ok(token.length > 0);
        const consultada = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token });
        assert.equal(consultada.status, 200);
        const body = consultada.body;
        assert.ok(body.organization);
        assert.deepEqual(Object.keys(body.organization).sort(), [
            'hasLogo', 'logoVersion', 'name', 'shortName', 'slug',
        ]);
        assert.equal(body.organization.hasLogo, false);
        assert.equal(body.organization.logoVersion, null);
        assert.equal(body.organization.slug, SLUG_A);
        assert.equal(body.organization.name, seedA.organizationName);
    });
    await check('GET /api/evaluaciones/:token expone la marca del club dueño de la evaluación (slug/name/shortName)', async () => {
        const token = `iso-test-eval-a-${RANDOM_SUFFIX}`;
        const res = await fetch(`${baseUrl}/api/evaluaciones/${token}`);
        const body = (await res.json().catch(() => undefined));
        assert.equal(res.status, 200);
        assert.ok(body?.organization);
        assert.deepEqual(Object.keys(body.organization).sort(), [
            'hasLogo', 'logoVersion', 'name', 'shortName', 'slug',
        ]);
        assert.equal(body.organization.hasLogo, false);
        assert.equal(body.organization.logoVersion, null);
        assert.equal(body.organization.slug, SLUG_A);
    });
    // ─── Invitaciones emitidas por la plataforma (bootstrap del primer ADMIN) ───
    // Repositorio real (Prisma) + email falso (nunca contacta Gmail): no hay
    // endpoint HTTP para crearlas todavía (llegará con el CLI de una fase
    // posterior), así que se llama al servicio directo, ya envuelto en el
    // contexto de club correspondiente — igual que hará ese CLI.
    const fakeInvitacionDeps = {
        repo: invitacionesRepoPrisma,
        sendEmail: async () => { },
        hashPassword: async (password) => `hashed:${password}`,
        now: () => new Date(),
        frontendUrl: 'https://iso-test.local',
    };
    await check('invitación de plataforma para el club A: crear → consultar (etiqueta de plataforma) → aceptar crea un ADMIN verificado', async () => {
        const email = `platform-admin-${RANDOM_SUFFIX}@iso-test.local`;
        const creada = await runWithOrganization(seedA.organizationId, () => crearInvitacionPlataforma(fakeInvitacionDeps, { organizationId: seedA.organizationId, email, rol: 'ADMIN' }));
        assert.equal(creada.ok, true);
        if (!creada.ok)
            return;
        assert.equal(creada.body.invitacion.invitadoPor, null);
        assert.equal(creada.body.invitacion.emitidaPorPlataforma, true);
        const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';
        assert.ok(token.length > 0);
        const consultada = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token });
        assert.equal(consultada.status, 200);
        const consultadaBody = consultada.body;
        assert.equal(consultadaBody.invitadoPor, 'el equipo de la plataforma');
        assert.equal(consultadaBody.rol, 'ADMIN');
        const aceptada = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', {
            token,
            name: 'Admin Plataforma',
            password: 'password123',
        });
        assert.equal(aceptada.status, 201);
        const creado = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
        assert.ok(creado);
        assert.equal(creado?.organizationId, seedA.organizationId);
        assert.equal(creado?.rol, 'ADMIN');
        assert.equal(creado?.emailVerified, true);
    });
    await check('el admin de B no ve por HTTP una invitación de plataforma emitida para A', async () => {
        const email = `platform-oculta-${RANDOM_SUFFIX}@iso-test.local`;
        const creada = await runWithOrganization(seedA.organizationId, () => crearInvitacionPlataforma(fakeInvitacionDeps, { organizationId: seedA.organizationId, email, rol: 'SOCIO' }));
        assert.equal(creada.ok, true);
        const res = await getJson(baseUrl, tokenB, '/api/invitaciones');
        assert.equal(res.status, 200);
        const body = res.body;
        assert.equal(body.invitaciones.some((i) => i.email === email), false);
    });
    // ─── Puente multi-club: la membresía de una ficha nueva la decide el servidor ──
    // El formulario de registro ya no pregunta a qué club dice pertenecer la
    // persona (esa pregunta se eliminó): toda ficha nueva es socia del club
    // donde se crea, y el body puede traer membresiaClub/nombreClub de un
    // frontend cacheado o de un cliente malicioso — el servidor debe ignorarlos
    // siempre (ver membresiaParaNuevaFicha en lib/integrante-membresia.ts).
    await check('POST /api/integrantes — la membresía de una ficha nueva es SIEMPRE la propia del club, aunque el body envíe la de otro', async () => {
        const fichaPayload = (rut, email) => ({
            nombreCompleto: 'Puente Multi-Club',
            rut,
            nacionalidad: 'Chilena',
            genero: 'OTRO',
            fechaNacimiento: '1990-01-01',
            direccion: 'Calle Falsa 789',
            comuna: 'Santiago',
            region: 'Metropolitana',
            telefonoCelular: '+56900000004',
            email,
            previsionSalud: 'FONASA',
            nombreContacto: 'Contacto Emergencia',
            parentesco: 'Hermano',
            telefonoContacto: '+56900000005',
            grupoSanguineo: 'O+',
            alergiasTiene: false,
            enfermedadesCronicasTiene: false,
            medicamentosTiene: false,
            cirugiasLesionesTiene: false,
            fuma: false,
            usaLentes: false,
            declaracionSalud: true,
            aceptacionRiesgo: true,
            consentimientoDatos: true,
            derechoImagen: true,
        });
        // Literales distintos de SHARED_RUT/SOCIO_RUT (arriba): no colisionan con
        // ninguna otra ficha sembrada en A o B durante esta corrida.
        const rutA = '33.333.333-3';
        const rutB = '44.444.444-4';
        const emailA = `bridge-ficha-a-${RANDOM_SUFFIX}@iso-test.local`;
        const emailB = `bridge-ficha-b-${RANDOM_SUFFIX}@iso-test.local`;
        // Club A: el body pide la membresía y el nombre de club de B — debe quedar
        // con la propia de A y nombreClub null.
        const creadaA = await postJsonAuth(baseUrl, tokenA, '/api/integrantes', {
            ...fichaPayload(rutA, emailA),
            membresiaClub: MEMBRESIA_B,
            nombreClub: 'Club Ajeno',
        });
        assert.equal(creadaA.status, 201);
        // Club B: mismo intento, en sentido inverso.
        const creadaB = await postJsonAuth(baseUrl, tokenB, '/api/integrantes', {
            ...fichaPayload(rutB, emailB),
            membresiaClub: MEMBRESIA_A,
            nombreClub: 'Otro Club',
        });
        assert.equal(creadaB.status, 201);
        const [resA, resB] = await Promise.all([
            getJson(baseUrl, tokenA, `/api/integrantes/by-rut/${encodeURIComponent(rutA)}`),
            getJson(baseUrl, tokenB, `/api/integrantes/by-rut/${encodeURIComponent(rutB)}`),
        ]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);
        const fichaA = resA.body;
        const fichaB = resB.body;
        assert.equal(fichaA.membresiaClub, MEMBRESIA_A);
        assert.equal(fichaA.nombreClub, null);
        assert.equal(fichaB.membresiaClub, MEMBRESIA_B);
        assert.equal(fichaB.nombreClub, null);
    });
    await check('suspender el club B: su token pasa a 403 y el club A sigue en 200', async () => {
        await runAsPlatform(() => prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'SUSPENDED' } }));
        const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, '/api/salidas'), getJson(baseUrl, tokenB, '/api/salidas')]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 403);
    });
}
// ─── QR reusable del club ───────────────────────────────────────────────────────
function buildFakeCodigosQrDeps(capturedEmails) {
    return {
        repo: codigosQrRepoPrisma,
        sendInvitationEmail: async (_organizationId, params) => {
            capturedEmails.push(params);
        },
        getOrganizationPublic: async (organizationId) => {
            const org = await prisma.organization.findUnique({
                where: { id: organizationId },
                select: { slug: true, name: true, shortName: true, logoObjectKey: true, status: true },
            });
            if (!org)
                return null;
            return { brand: toPublicOrganizationBrand(org), suspended: isOrganizationSuspended(org.status) };
        },
        withOrganization: (organizationId, fn) => runWithOrganization(organizationId, fn),
        hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
        now: () => new Date(),
        frontendUrl: 'https://iso-test.local',
        jwtSecret: requireJwtSecret(),
        logError: () => { },
    };
}
async function runQrChecks(baseUrl, seedA, seedB) {
    // El último paso de runHttpChecks deja a B en SUSPENDED a propósito; esta
    // sección necesita a B respondiendo con normalidad para sus propios checks
    // de aislamiento (listar/ver/revocar el código de A) — mismo motivo y mismo
    // patrón que runFileDownloadChecks más abajo.
    await runAsPlatform(() => prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'ACTIVE' } }));
    const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
    const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });
    let qrIdA = '';
    let qrTokenA = '';
    await check('ADMIN A crea un QR reusable y GET /api/qr/consultar expone la marca de SU club', async () => {
        const creado = await postJsonAuth(baseUrl, tokenA, '/api/invitaciones/qr', {
            duracion: '24h',
            maxUsos: 3,
            etiqueta: `iso-test-qr-${RANDOM_SUFFIX}`,
        });
        assert.equal(creado.status, 201);
        const body = creado.body;
        qrIdA = body.codigo.id;
        qrTokenA = body.qrUrl.split('#qr=')[1] ?? '';
        assert.ok(qrTokenA.length > 0);
        assert.equal(body.codigo.usosRestantes, 3);
        const consultado = await postJson(baseUrl, '/api/qr/consultar', { token: qrTokenA });
        assert.equal(consultado.status, 200);
        const consultadoBody = consultado.body;
        assert.equal(consultadoBody.organization.slug, SLUG_A);
    });
    const emailNuevoQr = `qr-nuevo-${RANDOM_SUFFIX}@iso-test.local`;
    await check('POST /api/qr/solicitar con un email nuevo mintea una Invitacion SOCIO en A y decrementa usosRestantes', async () => {
        const solicitado = await postJson(baseUrl, '/api/qr/solicitar', { token: qrTokenA, email: emailNuevoQr });
        assert.equal(solicitado.status, 202);
        assert.equal(solicitado.body.message, MENSAJE_SOLICITUD_GENERICA);
        const invitacion = await runAsPlatform(() => prisma.invitacion.findFirst({ where: { email: emailNuevoQr } }));
        assert.ok(invitacion);
        assert.equal(invitacion?.organizationId, seedA.organizationId);
        assert.equal(invitacion?.rol, 'SOCIO');
        assert.equal(invitacion?.invitadoPorId, seedA.adminUserId);
        assert.equal(invitacion?.codigoQrId, qrIdA);
        const listado = await getJson(baseUrl, tokenA, '/api/invitaciones/qr');
        assert.equal(listado.status, 200);
        const codigos = listado.body.codigos;
        const propio = codigos.find((c) => c.id === qrIdA);
        assert.equal(propio?.usosRestantes, 2);
    });
    await check('solicitar de nuevo con el MISMO email, o con el email de un ADMIN existente de OTRO club, da la misma respuesta 202 sin nueva fila', async () => {
        const repetida = await postJson(baseUrl, '/api/qr/solicitar', { token: qrTokenA, email: emailNuevoQr });
        const conCuentaExistente = await postJson(baseUrl, '/api/qr/solicitar', { token: qrTokenA, email: seedB.adminEmail });
        assert.deepEqual(repetida, { status: 202, body: { message: MENSAJE_SOLICITUD_GENERICA } });
        assert.deepEqual(conCuentaExistente, { status: 202, body: { message: MENSAJE_SOLICITUD_GENERICA } });
        const invitacionesEmailRepetido = await runAsPlatform(() => prisma.invitacion.findMany({ where: { email: emailNuevoQr } }));
        assert.equal(invitacionesEmailRepetido.length, 1);
        const invitacionEmailAdminB = await runAsPlatform(() => prisma.invitacion.findFirst({ where: { email: seedB.adminEmail } }));
        assert.equal(invitacionEmailAdminB, null);
    });
    await check('el admin de B no puede listar/ver/revocar el código QR de A (404, sin revelar existencia)', async () => {
        const verDesdeB = await getJson(baseUrl, tokenB, `/api/invitaciones/qr/${qrIdA}`);
        assert.equal(verDesdeB.status, 404);
        const revocarDesdeB = await postJsonAuth(baseUrl, tokenB, `/api/invitaciones/qr/${qrIdA}/revocar`, {});
        assert.equal(revocarDesdeB.status, 404);
        const listadoB = await getJson(baseUrl, tokenB, '/api/invitaciones/qr');
        assert.equal(listadoB.status, 200);
        const codigosB = listadoB.body.codigos;
        assert.equal(codigosB.some((c) => c.id === qrIdA), false);
    });
    await check('un token de QR en /api/auth/invitaciones/consultar (invitación individual) da 404', async () => {
        const res = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token: qrTokenA });
        assert.equal(res.status, 404);
    });
    await check('aceptar una invitación minteada por el QR de A, por HTTP, crea al usuario como SOCIO de A y permite iniciar sesión', async () => {
        const capturedEmails = [];
        const email = `qr-aceptada-${RANDOM_SUFFIX}@iso-test.local`;
        const resultado = await runAsPlatform(() => solicitarInvitacionQrService(buildFakeCodigosQrDeps(capturedEmails), qrTokenA, { email }));
        assert.equal(resultado.ok, true);
        assert.equal(capturedEmails.length, 1);
        const inviteToken = capturedEmails[0]?.inviteUrl.split('#invite=')[1] ?? '';
        assert.ok(inviteToken.length > 0);
        const aceptada = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', {
            token: inviteToken,
            name: 'Vía QR',
            password: 'password123',
        });
        assert.equal(aceptada.status, 201);
        const creado = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
        assert.ok(creado);
        assert.equal(creado?.organizationId, seedA.organizationId);
        assert.equal(creado?.rol, 'SOCIO');
        const login = await postJson(baseUrl, '/api/auth/login', { email, password: 'password123' });
        assert.equal(login.status, 200);
        const org = login.body.user.organization;
        assert.equal(org?.slug, SLUG_A);
    });
    await check('revocar el código de A (ADMIN A) lo deja no-activo; solicitar después da 410', async () => {
        const revocado = await postJsonAuth(baseUrl, tokenA, `/api/invitaciones/qr/${qrIdA}/revocar`, {});
        assert.equal(revocado.status, 200);
        const solicitado = await postJson(baseUrl, '/api/qr/solicitar', {
            token: qrTokenA,
            email: `qr-revocado-${RANDOM_SUFFIX}@iso-test.local`,
        });
        assert.equal(solicitado.status, 410);
    });
    await check('maxUsos=1: agotado el único uso, la siguiente solicitud (email nuevo) da 410', async () => {
        const creado = await postJsonAuth(baseUrl, tokenA, '/api/invitaciones/qr', { duracion: '2h', maxUsos: 1 });
        assert.equal(creado.status, 201);
        const token = creado.body.qrUrl.split('#qr=')[1] ?? '';
        const primera = await postJson(baseUrl, '/api/qr/solicitar', {
            token,
            email: `qr-agota-1-${RANDOM_SUFFIX}@iso-test.local`,
        });
        assert.equal(primera.status, 202);
        const segunda = await postJson(baseUrl, '/api/qr/solicitar', {
            token,
            email: `qr-agota-2-${RANDOM_SUFFIX}@iso-test.local`,
        });
        assert.equal(segunda.status, 410);
    });
    // Este check corre ANTES de que runHttpChecks suspenda B en su propio
    // último paso: suspende y reactiva el club B él mismo, para que las
    // verificaciones de runHttpChecks que siguen (que asumen B activo) no se
    // vean afectadas por este check.
    await check('club suspendido: solicitar sobre un QR válido de ese club da 410', async () => {
        await runAsPlatform(() => prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'SUSPENDED' } }));
        try {
            const { token, tokenHash } = generateInviteToken();
            await runAsPlatform(() => prisma.codigoQrInvitacion.create({
                data: {
                    organizationId: seedB.organizationId,
                    tokenHash,
                    tokenCifrado: cifrarTokenQr(token, requireJwtSecret()),
                    etiqueta: 'iso-test-club-suspendido',
                    maxUsos: 5,
                    usosRestantes: 5,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                    creadoPorId: seedB.adminUserId,
                },
            }));
            const solicitado = await postJson(baseUrl, '/api/qr/solicitar', {
                token,
                email: `qr-suspendido-${RANDOM_SUFFIX}@iso-test.local`,
            });
            assert.equal(solicitado.status, 410);
        }
        finally {
            await runAsPlatform(() => prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'ACTIVE' } }));
        }
    });
}
// ─── QR directo ("QR directo" — registro en el acto, sin correo) ──────────────
// runQrChecks deja a B de vuelta ACTIVE al terminar (try/finally de su último
// check), así que esta sección no necesita reactivarlo ella misma.
async function runQrDirectoChecks(baseUrl, seedA, seedB) {
    const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
    const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });
    let qrIdA = '';
    let qrTokenA = '';
    await check('ADMIN A crea un QR directo: modo DIRECTO, 1 uso', async () => {
        const creado = await postJsonAuth(baseUrl, tokenA, '/api/invitaciones/qr', { modo: 'DIRECTO' });
        assert.equal(creado.status, 201);
        const body = creado.body;
        assert.equal(body.codigo.modo, 'DIRECTO');
        assert.equal(body.codigo.maxUsos, 1);
        assert.equal(body.codigo.usosRestantes, 1);
        qrIdA = body.codigo.id;
        qrTokenA = body.qrUrl.split('#qr=')[1] ?? '';
        assert.ok(qrTokenA.length > 0);
    });
    await check('un código CORREO en POST /api/qr/registrar da 404 (no lo conoce)', async () => {
        const creadoCorreo = await postJsonAuth(baseUrl, tokenA, '/api/invitaciones/qr', {});
        assert.equal(creadoCorreo.status, 201);
        const tokenCorreo = creadoCorreo.body.qrUrl.split('#qr=')[1] ?? '';
        const res = await postJson(baseUrl, '/api/qr/registrar', {
            token: tokenCorreo,
            name: 'No Debería',
            email: `qr-directo-correo-${RANDOM_SUFFIX}@iso-test.local`,
            password: 'password123',
        });
        assert.equal(res.status, 404);
    });
    await check('un código DIRECTO en POST /api/qr/solicitar da 404 (nunca mintea invitación por correo)', async () => {
        const res = await postJson(baseUrl, '/api/qr/solicitar', {
            token: qrTokenA,
            email: `qr-directo-solicitar-${RANDOM_SUFFIX}@iso-test.local`,
        });
        assert.equal(res.status, 404);
    });
    await check('B (admin) no puede leer el estado del código directo de A (404, sin revelar existencia)', async () => {
        const res = await getJson(baseUrl, tokenB, `/api/invitaciones/qr/${qrIdA}/estado`);
        assert.equal(res.status, 404);
    });
    await check('GET estado antes de escanear: ACTIVO, registrado null', async () => {
        const res = await getJson(baseUrl, tokenA, `/api/invitaciones/qr/${qrIdA}/estado`);
        assert.equal(res.status, 200);
        const body = res.body;
        assert.equal(body.estado, 'ACTIVO');
        assert.equal(body.registrado, null);
    });
    await check('registrar con un email que ya tiene cuenta da 409 y NO consume el uso', async () => {
        const res = await postJson(baseUrl, '/api/qr/registrar', {
            token: qrTokenA,
            name: 'Ya Existe',
            email: seedA.socioEmail,
            password: 'password123',
        });
        assert.equal(res.status, 409);
        const estado = await getJson(baseUrl, tokenA, `/api/invitaciones/qr/${qrIdA}/estado`);
        assert.equal(estado.body.estado, 'ACTIVO');
    });
    const emailNuevo = `qr-directo-nuevo-${RANDOM_SUFFIX}@iso-test.local`;
    await check('registrar con el QR directo de A crea un SOCIO verificado en A, en el acto, que puede iniciar sesión', async () => {
        const res = await postJson(baseUrl, '/api/qr/registrar', {
            token: qrTokenA,
            name: 'Directo Nuevo',
            email: emailNuevo,
            password: 'password123',
        });
        assert.equal(res.status, 201);
        assert.deepEqual(res.body, { ok: true });
        const creado = await runAsPlatform(() => prisma.user.findUnique({ where: { email: emailNuevo } }));
        assert.ok(creado);
        assert.equal(creado?.organizationId, seedA.organizationId);
        assert.equal(creado?.rol, 'SOCIO');
        assert.equal(creado?.emailVerified, true);
        const login = await postJson(baseUrl, '/api/auth/login', { email: emailNuevo, password: 'password123' });
        assert.equal(login.status, 200);
        const org = login.body.user.organization;
        assert.equal(org?.slug, SLUG_A);
    });
    await check('el panel de quien invitó ve AGOTADO con el nombre/email de quien se registró', async () => {
        const res = await getJson(baseUrl, tokenA, `/api/invitaciones/qr/${qrIdA}/estado`);
        assert.equal(res.status, 200);
        const body = res.body;
        assert.equal(body.estado, 'AGOTADO');
        assert.equal(body.registrado?.name, 'Directo Nuevo');
        assert.equal(body.registrado?.email, emailNuevo);
    });
    await check('un segundo registro sobre el mismo código directo (ya agotado) da 410', async () => {
        const res = await postJson(baseUrl, '/api/qr/registrar', {
            token: qrTokenA,
            name: 'Otra Persona',
            email: `qr-directo-segunda-${RANDOM_SUFFIX}@iso-test.local`,
            password: 'password123',
        });
        assert.equal(res.status, 410);
    });
    await check('un código directo ya agotado deja de listarse en GET /api/invitaciones/qr', async () => {
        const listado = await getJson(baseUrl, tokenA, '/api/invitaciones/qr');
        assert.equal(listado.status, 200);
        const codigos = listado.body.codigos;
        assert.equal(codigos.some((c) => c.id === qrIdA), false);
    });
}
// La suite jamás debe escribir en un bucket real: getFileStorage() debe
// resolver al adaptador de memoria (la suite corre sin STORAGE_PROVIDER=gcs
// ni variables GCS_*). Lanza en vez de continuar en silencio.
function assertMemoryStorage() {
    const storage = getFileStorage();
    const candidate = storage;
    if (typeof candidate.has !== 'function' || typeof candidate.keys !== 'function') {
        throw new Error('getFileStorage() no resolvió al adaptador de memoria: esta sección jamás debe correr contra un bucket ' +
            'real. main() fuerza STORAGE_PROVIDER=memory al arrancar; si ves este error, algo resolvió ' +
            'getFileStorage() antes de ese punto.');
    }
    return storage;
}
// Extiende (nunca duplica) las filas ya sembradas por seedOrganization: la
// salida, el documento y el evento existentes ganan claves de objeto REALES
// (construidas con buildObjectKey para el organizationId del propio club) y
// un objeto chico correspondiente en el storage — así los checks de más abajo
// (URL firmada, huérfanos borrados) verifican comportamiento real, no solo
// strings sueltos.
async function seedFilesForOrg(storage, seed) {
    const gpxKey = buildObjectKey({ organizationId: seed.organizationId, kind: 'gpx', extension: 'gpx' });
    const pronosticoKey = buildObjectKey({ organizationId: seed.organizationId, kind: 'pronostico', extension: 'pdf' });
    const documentoKey = buildObjectKey({ organizationId: seed.organizationId, kind: 'documento', extension: 'pdf' });
    const itinerarioKey = buildObjectKey({ organizationId: seed.organizationId, kind: 'itinerario', extension: 'pdf' });
    await runAsPlatform(async () => {
        await prisma.salida.update({
            where: { id: seed.salidaId },
            data: {
                gpxFileId: gpxKey,
                gpxFileName: 'ruta.gpx',
                pronosticoFileId: pronosticoKey,
                pronosticoFileName: 'pronostico.pdf',
            },
        });
        await prisma.documento.update({
            where: { id: seed.documentoId },
            data: { driveFileId: documentoKey },
        });
        // PUBLICADO con fechas futuras: visible para cualquier socio del club (no
        // solo el admin — puedeVerEvento solo exige admin/gestor para BORRADOR),
        // y sigue dentro de la ventana temporal por defecto de GET /api/eventos.
        await prisma.evento.update({
            where: { id: seed.eventoId },
            data: {
                estado: 'PUBLICADO',
                fechaInicio: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                fechaFin: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
                itinerarioFileId: itinerarioKey,
                itinerarioFileName: 'itinerario.pdf',
            },
        });
    });
    for (const key of [gpxKey, pronosticoKey, documentoKey, itinerarioKey]) {
        await storage.upload(Readable.from([Buffer.from(`contenido iso-test ${key}`)]), {
            key,
            contentType: 'application/octet-stream',
            maxBytes: 4096,
        });
    }
    return { gpxKey, pronosticoKey, documentoKey, itinerarioKey };
}
// Fila que NINGÚN flujo de la API puede producir: pertenece a orgBId pero su
// driveFileId es una clave de objeto de orgAId — solo se puede escribir a
// mano, en contexto de plataforma. Ejercita la defensa en profundidad de
// resolveFileDownload (objectKeyBelongsTo) además del aislamiento por fila.
async function seedMismatchDocumento(orgBId, orgAId) {
    const foreignKey = buildObjectKey({ organizationId: orgAId, kind: 'documento', extension: 'pdf' });
    const documento = await runAsPlatform(() => prisma.documento.create({
        data: {
            organizationId: orgBId,
            categoria: 'OTRO',
            nombre: 'Documento mismatch iso-test',
            driveFileId: foreignKey,
        },
    }));
    return documento.id;
}
// Fila legada: id sin forma de clave de objeto (como un fileId de Drive) más
// una URL legada — ejercita la rama "legacy" de resolveFileDownload.
async function seedLegacyDocumento(orgAId, legacyUrl) {
    const documento = await runAsPlatform(() => prisma.documento.create({
        data: {
            organizationId: orgAId,
            categoria: 'OTRO',
            nombre: 'Documento legado iso-test',
            driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
            driveFileUrl: legacyUrl,
        },
    }));
    return documento.id;
}
async function runFileDownloadChecks(baseUrl, seedA, seedB) {
    const storage = assertMemoryStorage();
    // El último check de runHttpChecks deja al club B en SUSPENDED (a
    // propósito, para probar esa regla) y nada más lo reactiva. Esta sección
    // necesita a AMBOS clubes respondiendo con normalidad — si no, cualquier
    // 403 de suspensión se confundiría con un 404 de aislamiento. No se toca
    // ni se reordena el check de suspensión de runHttpChecks: se revierte acá.
    await runAsPlatform(() => prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'ACTIVE' } }));
    const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
    const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });
    // Precondición explícita: si la reactivación fallara (o algo la revirtiera
    // más adelante), este check nombra la causa real en vez de que aparezcan
    // seis 403 inexplicables disfrazados de fallos de aislamiento.
    await check('club B reactivado: su token vuelve a responder 200 en un endpoint autenticado', async () => {
        const res = await getRaw(baseUrl, tokenB, '/api/salidas');
        assert.equal(res.status, 200);
    });
    let filesA;
    let filesB;
    let mismatchDocId;
    let legacyDocId;
    const LEGACY_URL = 'https://legacy-storage.example/documento/legado.pdf';
    try {
        filesA = await seedFilesForOrg(storage, seedA);
        filesB = await seedFilesForOrg(storage, seedB);
        mismatchDocId = await seedMismatchDocumento(seedB.organizationId, seedA.organizationId);
        legacyDocId = await seedLegacyDocumento(seedA.organizationId, LEGACY_URL);
        // ── Camino feliz: cada club obtiene su propia URL firmada (simétrico: ──────
        // B ahora está activo y también debe poder firmar las suyas — al menos
        // salida/gpx y documento, para no duplicar la cobertura completa de A).
        const ownPathChecks = [
            { label: 'A salida/gpx', token: tokenA, org: seedA, path: `/api/salidas/${seedA.salidaId}/archivos/gpx/url` },
            {
                label: 'A salida/pronostico',
                token: tokenA,
                org: seedA,
                path: `/api/salidas/${seedA.salidaId}/archivos/pronostico/url`,
            },
            { label: 'A documento', token: tokenA, org: seedA, path: `/api/documentos/${seedA.documentoId}/url` },
            {
                label: 'A evento/itinerario',
                token: tokenA,
                org: seedA,
                path: `/api/eventos/${seedA.eventoId}/itinerario/url`,
            },
            { label: 'B salida/gpx', token: tokenB, org: seedB, path: `/api/salidas/${seedB.salidaId}/archivos/gpx/url` },
            { label: 'B documento', token: tokenB, org: seedB, path: `/api/documentos/${seedB.documentoId}/url` },
        ];
        for (const { label, token, org, path } of ownPathChecks) {
            await check(`GET ${path} — el propio club obtiene su URL firmada (${label})`, async () => {
                const res = await getRaw(baseUrl, token, path);
                assert.equal(res.status, 200);
                const body = res.body;
                assert.equal(body.expiresInSeconds, 600);
                assert.ok(body.url.includes(`orgs/${org.organizationId}/`), `la URL firmada debía incluir el prefijo del propio club: ${body.url}`);
                assert.equal(res.headers.get('cache-control'), 'no-store');
            });
        }
        await check('GET /api/salidas/:id/archivos/:tipo/url — tipo fuera de gpx|pronostico responde 400', async () => {
            const res = await getRaw(baseUrl, tokenA, `/api/salidas/${seedA.salidaId}/archivos/otro/url`);
            assert.equal(res.status, 400);
        });
        // ── Entre clubes: B nunca ve los archivos de A, sin filtrar datos de A ─────
        const crossPathChecks = [
            { label: 'salida/gpx', path: `/api/salidas/${seedA.salidaId}/archivos/gpx/url` },
            { label: 'salida/pronostico', path: `/api/salidas/${seedA.salidaId}/archivos/pronostico/url` },
            { label: 'documento', path: `/api/documentos/${seedA.documentoId}/url` },
            { label: 'evento/itinerario', path: `/api/eventos/${seedA.eventoId}/itinerario/url` },
        ];
        for (const { label, path } of crossPathChecks) {
            await check(`GET ${path} con el token de B responde 404 sin filtrar datos de A (${label})`, async () => {
                const res = await getRaw(baseUrl, tokenB, path);
                assert.equal(res.status, 404);
                const raw = JSON.stringify(res.body);
                for (const leaked of [
                    seedA.organizationId,
                    filesA.gpxKey,
                    filesA.pronosticoKey,
                    filesA.documentoKey,
                    filesA.itinerarioKey,
                ]) {
                    assert.equal(raw.includes(leaked), false, `la respuesta filtró "${leaked}"`);
                }
            });
        }
        await check('GET /api/salidas/:id/archivos/gpx/url — en la otra dirección (token de A sobre la salida de B) también 404', async () => {
            const res = await getRaw(baseUrl, tokenA, `/api/salidas/${seedB.salidaId}/archivos/gpx/url`);
            assert.equal(res.status, 404);
            const raw = JSON.stringify(res.body);
            assert.equal(raw.includes(seedB.organizationId), false);
            assert.equal(raw.includes(filesB.gpxKey), false);
        });
        // ── Defensa en profundidad: clave de A guardada (a mano) en una fila de B ──
        await check('GET /api/documentos/:id/url — una clave de A en una fila de B nunca firma: 404', async () => {
            const res = await getRaw(baseUrl, tokenB, `/api/documentos/${mismatchDocId}/url`);
            assert.equal(res.status, 404);
            const raw = JSON.stringify(res.body);
            assert.equal(raw.includes(seedA.organizationId), false);
        });
        // ── Fila legada: la URL de Drive sigue funcionando, pero solo para su club ─
        await check('GET /api/documentos/:id/url — fila legada de A responde la URL legada (expiresInSeconds: null)', async () => {
            const res = await getRaw(baseUrl, tokenA, `/api/documentos/${legacyDocId}/url`);
            assert.equal(res.status, 200);
            assert.deepEqual(res.body, { url: LEGACY_URL, expiresInSeconds: null });
        });
        await check('GET /api/documentos/:id/url — la fila legada de A es 404 para B', async () => {
            const res = await getRaw(baseUrl, tokenB, `/api/documentos/${legacyDocId}/url`);
            assert.equal(res.status, 404);
        });
        // ── Los listados/detalles nunca filtran una columna *FileUrl ───────────────
        const noUrlLeakChecks = [
            { label: 'GET /api/salidas', path: '/api/salidas' },
            { label: 'GET /api/salidas/:id', path: `/api/salidas/${seedA.salidaId}` },
            { label: 'GET /api/documentos', path: '/api/documentos' },
            { label: 'GET /api/documentos/admin', path: '/api/documentos/admin' },
            { label: 'GET /api/eventos', path: '/api/eventos' },
            { label: 'GET /api/eventos/:id', path: `/api/eventos/${seedA.eventoId}` },
        ];
        const forbiddenFields = ['gpxFileUrl', 'pronosticoFileUrl', 'driveFileUrl', 'itinerarioFileUrl'];
        for (const { label, path } of noUrlLeakChecks) {
            await check(`${label} nunca incluye una columna *FileUrl`, async () => {
                const res = await getRaw(baseUrl, tokenA, path);
                assert.equal(res.status, 200);
                const raw = JSON.stringify(res.body);
                for (const field of forbiddenFields) {
                    assert.equal(raw.includes(field), false, `se encontró "${field}" en la respuesta de ${path}`);
                }
            });
        }
        // ── Corrección de huérfanos de punta a punta ───────────────────────────────
        await check('DELETE /api/salidas/:id — borra sus dos objetos del storage y no toca los de B', async () => {
            assert.equal(storage.has(filesA.gpxKey), true);
            assert.equal(storage.has(filesA.pronosticoKey), true);
            const res = await deleteJson(baseUrl, tokenA, `/api/salidas/${seedA.salidaId}`);
            assert.equal(res.status, 204);
            assert.equal(storage.has(filesA.gpxKey), false);
            assert.equal(storage.has(filesA.pronosticoKey), false);
            assert.equal(storage.has(filesB.gpxKey), true);
            assert.equal(storage.has(filesB.pronosticoKey), true);
        });
    }
    finally {
        // Limpieza propia de esta sección — no depende del purgeOrganization final
        // de main() para dejar la base y el storage exactamente como los encontró.
        const extraDocIds = [mismatchDocId, legacyDocId].filter((id) => Boolean(id));
        if (extraDocIds.length > 0) {
            await runAsPlatform(() => prisma.documento.deleteMany({ where: { id: { in: extraDocIds } } })).catch((err) => console.error('[test-isolation] No se pudieron limpiar las filas extra de documentos:', err));
        }
        const leftoverKeys = [
            filesA?.documentoKey,
            filesA?.itinerarioKey,
            filesB?.gpxKey,
            filesB?.pronosticoKey,
            filesB?.documentoKey,
            filesB?.itinerarioKey,
        ].filter((key) => Boolean(key));
        for (const key of leftoverKeys) {
            await storage.delete(key).catch((err) => console.error('[test-isolation] No se pudo limpiar el objeto', key, err));
        }
    }
}
// ─── CLI de administración de clubes (Fase 7: alta operativa por consola) ──────
// Un club creado por el servicio del CLI (services/tenants.service.ts) debe
// quedar operativo de punta a punta, no solo con la fila de Organization en
// pie. Corre DESPUÉS de runFileDownloadChecks y ANTES de la limpieza final:
// el club que crea (slug "iso-test-cli-<sufijo>") lo purga el mismo barrido
// final que ya purga A y B (purgeAllIsoTestOrganizations filtra por prefijo
// de slug, no por id, así que no hace falta extenderlo).
// Logo propio del club: es el ÚNICO recurso del bucket que se sirve por una
// ruta pública (GET /api/clubes/:slug/logo, sin sesión, porque el login tiene
// que poder pintarlo). Justo por eso necesita sus propios checks de
// aislamiento: el slug viaja en la URL y es lo único que elige de qué club se
// leen bytes.
async function runClubLogoChecks(baseUrl, seedA, seedB) {
    const storage = assertMemoryStorage();
    const socioTokenA = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
    const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });
    const marca = async (slug) => {
        const res = await fetch(`${baseUrl}/api/clubes/${slug}/marca`);
        const body = (await res.json().catch(() => undefined));
        return { status: res.status, body };
    };
    await check('sin logo subido, la marca pública de cada club dice hasLogo:false', async () => {
        for (const slug of [SLUG_A, SLUG_B]) {
            const res = await marca(slug);
            assert.equal(res.status, 200);
            assert.equal(res.body?.hasLogo, false);
            assert.equal(res.body?.logoVersion, null);
        }
    });
    await check('sin logo subido, GET /api/clubes/:slug/logo responde 404', async () => {
        const res = await fetch(`${baseUrl}/api/clubes/${SLUG_A}/logo`);
        assert.equal(res.status, 404);
    });
    await check('un slug que no existe no revela nada: 404 en la marca pública', async () => {
        const res = await marca(`iso-test-no-existe-${RANDOM_SUFFIX}`);
        assert.equal(res.status, 404);
    });
    // A partir de acá SOLO el club A tiene logo. Todo lo que siga comprueba que
    // eso no se derrama al club B por ninguna vía.
    const logoBytes = Buffer.from('iso-test-logo-png-del-club-A');
    const logoKeyA = buildObjectKey({ organizationId: seedA.organizationId, kind: 'logo', extension: 'png' });
    await storage.upload(Readable.from([logoBytes]), {
        key: logoKeyA,
        contentType: 'image/png',
        maxBytes: 4096,
    });
    await runAsPlatform(() => prisma.organization.update({ where: { id: seedA.organizationId }, data: { logoObjectKey: logoKeyA } }));
    await check('el logo del club A se sirve bajo SU slug, con sus bytes y su Content-Type', async () => {
        const res = await fetch(`${baseUrl}/api/clubes/${SLUG_A}/logo`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/png');
        assert.ok(res.headers.get('etag'), 'debería venir un ETag');
        const descargado = Buffer.from(await res.arrayBuffer());
        assert.ok(descargado.equals(logoBytes), 'los bytes servidos no son los del club A');
    });
    await check('el logo del club A NO se sirve bajo el slug del club B', async () => {
        const res = await fetch(`${baseUrl}/api/clubes/${SLUG_B}/logo`);
        assert.equal(res.status, 404);
    });
    await check('la marca pública refleja el logo solo en el club que lo subió', async () => {
        const a = await marca(SLUG_A);
        assert.equal(a.body?.hasLogo, true);
        assert.equal(typeof a.body?.logoVersion, 'string');
        const b = await marca(SLUG_B);
        assert.equal(b.body?.hasLogo, false);
        assert.equal(b.body?.logoVersion, null);
    });
    await check('la marca pública nunca expone la clave cruda del objeto', async () => {
        const a = await marca(SLUG_A);
        assert.deepEqual(Object.keys(a.body).sort(), ['hasLogo', 'logoVersion', 'name', 'shortName', 'slug']);
        assert.ok(!JSON.stringify(a.body).includes(logoKeyA), 'se filtró logoObjectKey en la marca pública');
    });
    await check('un SOCIO no puede quitar el logo de su propio club (solo ADMIN)', async () => {
        const res = await deleteJson(baseUrl, socioTokenA, '/api/organizacion/logo');
        assert.equal(res.status, 403);
    });
    await check('el admin del club B quitando su logo no toca el del club A', async () => {
        const res = await deleteJson(baseUrl, tokenB, '/api/organizacion/logo');
        assert.equal(res.status, 200);
        const a = await marca(SLUG_A);
        assert.equal(a.body?.hasLogo, true);
        assert.equal(await storage.has(logoKeyA), true);
    });
    await check('el admin del club A quita su logo: deja de servirse y el objeto desaparece', async () => {
        const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
        const res = await deleteJson(baseUrl, tokenA, '/api/organizacion/logo');
        assert.equal(res.status, 200);
        const a = await marca(SLUG_A);
        assert.equal(a.body?.hasLogo, false);
        const logo = await fetch(`${baseUrl}/api/clubes/${SLUG_A}/logo`);
        assert.equal(logo.status, 404);
        assert.equal(await storage.has(logoKeyA), false);
    });
}
async function runTenantCliChecks(baseUrl, seedA, seedB) {
    const cliSlug = `iso-test-cli-${RANDOM_SUFFIX}`;
    const cliAdminEmail = `admin-cli-${RANDOM_SUFFIX}@iso-test.local`;
    const cliSocioEmail = `socio-cli-${RANDOM_SUFFIX}@iso-test.local`;
    const cliReinviteEmail = `reinvite-admin-cli-${RANDOM_SUFFIX}@iso-test.local`;
    const CLI_PASSWORD = 'password123';
    // Repositorio real + invitación de plataforma con correo falso (nunca
    // contacta Gmail/SMTP) — mismo patrón que fakeInvitacionDeps más arriba,
    // pero envuelto por tenants.service.ts en vez de llamado directo.
    const fakeInvitacionDepsCli = {
        repo: invitacionesRepoPrisma,
        sendEmail: async () => { },
        hashPassword: async (password) => `hashed:${password}`,
        now: () => new Date(),
        frontendUrl: 'https://iso-test-cli.local',
    };
    const crearInvitacionAdminFake = (organizationId, email) => runWithOrganization(organizationId, () => crearInvitacionPlataforma(fakeInvitacionDepsCli, { organizationId, email, rol: 'ADMIN' }));
    const depsOperativos = {
        repo: tenantsRepoPrisma,
        crearInvitacionAdmin: crearInvitacionAdminFake,
        now: () => new Date(),
    };
    const cliInput = {
        slug: cliSlug,
        name: `Iso Test Club CLI ${RANDOM_SUFFIX}`,
        membresiaPropia: MEMBRESIA_A,
        alertEmail: `alert-cli-${RANDOM_SUFFIX}@iso-test.local`,
        contactName: 'Contacto CLI',
        contactEmail: `contacto-cli-${RANDOM_SUFFIX}@iso-test.local`,
        adminEmail: cliAdminEmail,
    };
    // Las dos únicas membresías propias válidas hoy (MEMBRESIAS_PROPIAS) ya las
    // usan el club real de Pamir y los clubes A/B que sembró esta misma suite
    // (MEMBRESIA_A y MEMBRESIA_B) — no queda ningún código libre para probar el
    // camino operativo completo de un tercer club sin reutilizar uno de los
    // dos. Por eso esta comprobación corre primero, contra el repositorio REAL
    // (sin bypass), y demuestra que la regla de unicidad sí rechaza esa
    // colisión antes de usar, solo para el resto de esta sección, un
    // repositorio cuya ÚNICA diferencia con el real es que nunca la reporta.
    await check('crearClub (CLI) rechaza una membresía ya usada por otro club', async () => {
        const rechazo = await runAsPlatform(() => crearClub(depsOperativos, cliInput));
        assert.equal(rechazo.ok, false);
        if (rechazo.ok)
            return;
        assert.equal(rechazo.status, 409);
        assert.match(rechazo.error, new RegExp(MEMBRESIA_A));
    });
    const repoConMembresiaLibre = {
        ...tenantsRepoPrisma,
        async findOrganizationByMembresia() {
            return null;
        },
    };
    const depsConMembresiaLibre = {
        repo: repoConMembresiaLibre,
        crearInvitacionAdmin: crearInvitacionAdminFake,
        now: () => new Date(),
    };
    // Creación real, fuera de check(): si esto falla, todo lo que sigue en esta
    // sección carece de sentido — igual que seedOrganization() más arriba,
    // deja que el error se propague al catch general de main().
    const creado = await runAsPlatform(() => crearClub(depsConMembresiaLibre, cliInput));
    if (!creado.ok) {
        throw new Error(`[test-isolation] crearClub (operativo, con bypass de membresía) falló: ${creado.error}`);
    }
    const cliOrganizationId = creado.body.organization.id;
    if (!creado.body.invitacion.emitida) {
        throw new Error('[test-isolation] la invitación del primer ADMIN del club creado por el CLI no se emitió');
    }
    const primerTokenAdmin = creado.body.invitacion.inviteUrl.split('#invite=')[1] ?? '';
    await check('crearClub (CLI) crea 6 categorías y una declaración vigente con hash reproducible', async () => {
        assert.equal(creado.body.categoriasCreadas, 6);
        assert.equal(creado.body.declaracion.version, '2026-08');
        const categoriasCount = await runAsPlatform(() => prisma.categoriaEvento.count({ where: { organizationId: cliOrganizationId } }));
        assert.equal(categoriasCount, 6);
        const declaracionDb = await runAsPlatform(() => prisma.declaracionJuradaVersion.findFirst({
            where: { organizationId: cliOrganizationId, vigenteHasta: null },
        }));
        assert.ok(declaracionDb);
        const items = declaracionDb?.items;
        assert.equal(declaracionDb?.hashSha256, computeDeclaracionHash(declaracionDb?.titulo ?? '', items));
    });
    let cliAdminToken = '';
    let cliEventoId = '';
    await check('el club creado por el CLI queda operativo de punta a punta: acepta la invitación, inicia sesión, ve sus 6 categorías y publica un evento con declaración vigente', async () => {
        const aceptar = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', {
            token: primerTokenAdmin,
            name: 'Admin Club CLI',
            password: CLI_PASSWORD,
        });
        assert.equal(aceptar.status, 201);
        const login = await postJson(baseUrl, '/api/auth/login', { email: cliAdminEmail, password: CLI_PASSWORD });
        assert.equal(login.status, 200);
        cliAdminToken = login.body.token;
        const categorias = await getJson(baseUrl, cliAdminToken, '/api/eventos/categorias');
        assert.equal(categorias.status, 200);
        const listaCategorias = categorias.body;
        assert.equal(listaCategorias.length, 6);
        const crearEvento = await postJsonAuth(baseUrl, cliAdminToken, '/api/eventos', {
            titulo: 'Evento operativo iso-test-cli',
            categoriaId: listaCategorias[0]?.id,
            fechaInicio: fechaEnDias(30),
            fechaFin: fechaEnDias(31),
            duracionTexto: '2 días',
            ubicacion: 'Cordillera',
            reunionCoordinacion: 'Sede del club',
            organizadorNombre: 'Club CLI',
            cupos: 10,
            fechaCorte: { fecha: fechaEnDias(20), hora: '12:00' },
            objetivo: 'Objetivo de prueba iso-test',
            itinerario: 'Itinerario de prueba iso-test',
        });
        assert.equal(crearEvento.status, 201);
        cliEventoId = crearEvento.body.id;
        const publicar = await postJsonAuth(baseUrl, cliAdminToken, `/api/eventos/${cliEventoId}/publicar`, {});
        assert.equal(publicar.status, 200);
        const detalle = await getJson(baseUrl, cliAdminToken, `/api/eventos/${cliEventoId}`);
        assert.equal(detalle.status, 200);
        const detalleBody = detalle.body;
        assert.equal(detalleBody.estado, 'PUBLICADO');
        assert.equal(detalleBody.declaracionVigente?.version, '2026-08');
    });
    await check('POST /api/auth/login devuelve la organización pública propia del club recién creado (7 campos, sin datos privados)', async () => {
        const login = await postJson(baseUrl, '/api/auth/login', { email: cliAdminEmail, password: CLI_PASSWORD });
        assert.equal(login.status, 200);
        const org = login.body.user.organization;
        assert.ok(org);
        assert.deepEqual(Object.keys(org).sort(), [
            'hasLogo', 'id', 'logoVersion', 'membresiaPropia', 'name', 'shortName', 'slug',
        ]);
        assert.equal(org.hasLogo, false);
        assert.equal(org.logoVersion, null);
        assert.equal(org.slug, cliSlug);
        assert.equal(org.membresiaPropia, MEMBRESIA_A);
    });
    await check('invita a un SOCIO del club nuevo (invitación normal, no de plataforma)', async () => {
        const invitar = await postJsonAuth(baseUrl, cliAdminToken, '/api/invitaciones', {
            email: cliSocioEmail,
            rol: 'SOCIO',
        });
        assert.equal(invitar.status, 201);
    });
    await check('ni el club A ni el club B ven el evento del club nuevo, y el admin del club nuevo no ve la salida del club A', async () => {
        const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
        const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });
        const [resDesdeA, resDesdeB] = await Promise.all([
            getJson(baseUrl, tokenA, `/api/eventos/${cliEventoId}`),
            getJson(baseUrl, tokenB, `/api/eventos/${cliEventoId}`),
        ]);
        assert.equal(resDesdeA.status, 404);
        assert.equal(resDesdeB.status, 404);
        const resSalidaDesdeCli = await getJson(baseUrl, cliAdminToken, `/api/salidas/${seedA.salidaId}`);
        assert.equal(resSalidaDesdeCli.status, 404);
    });
    await check('suspende el club nuevo: el token del admin recibe 403 y el login queda rechazado', async () => {
        const suspender = await runAsPlatform(() => cambiarEstadoClub(depsOperativos, cliSlug, 'SUSPENDED'));
        assert.equal(suspender.ok, true);
        if (!suspender.ok)
            return;
        assert.equal(suspender.body.estadoAnterior, 'ACTIVE');
        assert.equal(suspender.body.estadoNuevo, 'SUSPENDED');
        assert.equal(suspender.body.sinCambios, false);
        const resAutenticado = await getJson(baseUrl, cliAdminToken, '/api/eventos/categorias');
        assert.equal(resAutenticado.status, 403);
        const loginRechazado = await postJson(baseUrl, '/api/auth/login', { email: cliAdminEmail, password: CLI_PASSWORD });
        assert.equal(loginRechazado.status, 403);
    });
    await check('reactiva el club nuevo: vuelve a responder 200, y repetir la reactivación es un no-op', async () => {
        const activar = await runAsPlatform(() => cambiarEstadoClub(depsOperativos, cliSlug, 'ACTIVE'));
        assert.equal(activar.ok, true);
        if (!activar.ok)
            return;
        assert.equal(activar.body.estadoAnterior, 'SUSPENDED');
        assert.equal(activar.body.estadoNuevo, 'ACTIVE');
        assert.equal(activar.body.sinCambios, false);
        const resReactivado = await getJson(baseUrl, cliAdminToken, '/api/eventos/categorias');
        assert.equal(resReactivado.status, 200);
        const activarDeNuevo = await runAsPlatform(() => cambiarEstadoClub(depsOperativos, cliSlug, 'ACTIVE'));
        assert.equal(activarDeNuevo.ok, true);
        if (!activarDeNuevo.ok)
            return;
        assert.equal(activarDeNuevo.body.sinCambios, true);
    });
    await check('invitarAdminClub reemite el link: el primer token deja de servir y el segundo queda vigente', async () => {
        const primera = await runAsPlatform(() => invitarAdminClub(depsOperativos, cliSlug, cliReinviteEmail));
        assert.equal(primera.ok, true);
        if (!primera.ok)
            return;
        const primerToken = primera.body.inviteUrl.split('#invite=')[1] ?? '';
        const segunda = await runAsPlatform(() => invitarAdminClub(depsOperativos, cliSlug, cliReinviteEmail));
        assert.equal(segunda.ok, true);
        if (!segunda.ok)
            return;
        const segundoToken = segunda.body.inviteUrl.split('#invite=')[1] ?? '';
        const consultaPrimero = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token: primerToken });
        assert.equal(consultaPrimero.status, 410);
        const consultaSegundo = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token: segundoToken });
        assert.equal(consultaSegundo.status, 200);
    });
    await check('listarClubes incluye el club nuevo con los conteos correctos', async () => {
        const listado = await runAsPlatform(() => listarClubes(depsOperativos));
        const fila = listado.find((c) => c.slug === cliSlug);
        assert.ok(fila);
        assert.equal(fila?.status, 'ACTIVE');
        assert.equal(fila?.membresiaPropia, MEMBRESIA_A);
        // El admin (aceptó) cuenta; el SOCIO invitado (nunca aceptó) no crea usuario.
        assert.equal(fila?.userCount, 1);
        // Pendientes: la invitación del SOCIO + el segundo token de la reemisión
        // (el primero quedó revocado, la del ADMIN original ya fue aceptada).
        assert.equal(fila?.pendingInvitationCount, 2);
    });
}
// ─── Orquestación ──────────────────────────────────────────────────────────────
async function main() {
    // Guardia real (no solo el pre-hook npm db:guard): correr este archivo
    // directamente con node/tsx ya no puede saltarse la verificación de destino.
    verifyDbTargetOrExit({
        prefix: '[test-isolation]',
        onMissingTarget: () => console.log('[test-isolation] DATABASE_URL no está definido o no se pudo interpretar como una URL válida.'),
        failureMessage: '[test-isolation] Comando abortado: DATABASE_URL no coincide con la base de datos de v2 declarada en ' +
            'backend/db-target.json. Ejecuta este script solo a través de "npm run test:isolation" o corrige DATABASE_URL.',
    });
    // La suite jamás debe escribir en un bucket real: fuerza el adaptador de
    // memoria aunque el .env de desarrollo seleccione GCS. getFileStorage() es
    // perezoso y memoizado, así que basta con fijarlo antes de la primera
    // llamada; assertMemoryStorage() lo vuelve a comprobar sobre la instancia
    // realmente resuelta.
    process.env.STORAGE_PROVIDER = 'memory';
    // Por la misma razón, jamás debe enviar correo real: la suite crea
    // invitaciones por HTTP cuyos destinatarios son direcciones ficticias
    // (@iso-test.local). Con un .env de desarrollo que ya trae SMTP_*, cada
    // invitación intentaría una entrega real contra un dominio inexistente y
    // ensuciaría la reputación del servidor de correo.
    process.env.EMAIL_PROVIDER = 'console';
    console.log('[test-isolation] Limpiando restos de una corrida anterior (si los hay)...');
    await purgeAllIsoTestOrganizations();
    let server;
    try {
        const seedA = await seedOrganization('A', SLUG_A);
        const seedB = await seedOrganization('B', SLUG_B);
        for (const probe of buildProbes(seedA, seedB)) {
            await runProbeChecks(probe, seedA.organizationId, seedB.organizationId);
        }
        await runCrossCuttingChecks(seedA, seedB);
        const started = await startServer();
        server = started.server;
        await runHttpChecks(started.baseUrl, seedA, seedB);
        // DESPUÉS de runHttpChecks a propósito: crea usuarios/invitaciones nuevos
        // en A, y los checks de conteo exacto de runHttpChecks (admin/users,
        // invitaciones) ya corrieron. runQrChecks reactiva B él mismo al empezar
        // (el último paso de runHttpChecks lo deja SUSPENDED) — mismo motivo que
        // runFileDownloadChecks más abajo.
        await runQrChecks(started.baseUrl, seedA, seedB);
        // DESPUÉS de runQrChecks: reutiliza sus mismos seeds/tokens y deja a B
        // ACTIVE tal como runQrChecks lo dejó.
        await runQrDirectoChecks(started.baseUrl, seedA, seedB);
        await runFileDownloadChecks(started.baseUrl, seedA, seedB);
        await runClubLogoChecks(started.baseUrl, seedA, seedB);
        await runTenantCliChecks(started.baseUrl, seedA, seedB);
    }
    catch (err) {
        results.push({
            label: 'ejecución general del script (fuera de un check individual)',
            ok: false,
            detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
    }
    finally {
        if (server) {
            await stopServer(server);
        }
        await purgeAllIsoTestOrganizations();
    }
    const remaining = await countIsoTestOrganizations();
    results.push({
        label: 'limpieza final: no quedan organizaciones "iso-test-*"',
        ok: remaining === 0,
        detail: remaining > 0 ? `quedaron ${remaining} organizaciones sin limpiar` : undefined,
    });
    printReport();
    await prisma.$disconnect();
    process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
}
main().catch((err) => {
    console.error('[test-isolation] Error fatal:', err);
    process.exitCode = 1;
});
