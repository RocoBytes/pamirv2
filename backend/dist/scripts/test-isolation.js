// Suite de aislamiento multi-club de extremo a extremo. Corre contra la base
// de datos REAL de desarrollo (protegida por db:guard — ver package.json) y
// debe dejarla exactamente como la encontró. No se ejecuta como parte de
// `npm test` (usa `npm run test:isolation`): abre conexiones reales y levanta
// un servidor HTTP efímero.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma.js';
import { verifyDbTargetOrExit } from '../lib/db-target-guard.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { signToken } from '../lib/jwt.js';
import { crearInvitacionPlataforma } from '../services/invitaciones.service.js';
import { invitacionesRepoPrisma } from '../services/invitaciones.repo.prisma.js';
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
    await check('suspender el club B: su token pasa a 403 y el club A sigue en 200', async () => {
        await runAsPlatform(() => prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'SUSPENDED' } }));
        const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, '/api/salidas'), getJson(baseUrl, tokenB, '/api/salidas')]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 403);
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
