// Suite de aislamiento multi-club de extremo a extremo. Corre contra la base
// de datos REAL de desarrollo (protegida por db:guard — ver package.json) y
// debe dejarla exactamente como la encontró. No se ejecuta como parte de
// `npm test` (usa `npm run test:isolation`): abre conexiones reales y levanta
// un servidor HTTP efímero.
import 'dotenv/config';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { verifyDbTargetOrExit } from '../lib/db-target-guard.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { signToken } from '../lib/jwt.js';
import { Prisma } from '../generated/prisma/client.js';
import { crearInvitacionPlataforma, type InvitacionesDeps } from '../services/invitaciones.service.js';
import { invitacionesRepoPrisma } from '../services/invitaciones.repo.prisma.js';
import {
  solicitarInvitacionQr as solicitarInvitacionQrService,
  MENSAJE_SOLICITUD_GENERICA,
  type CodigosQrDeps,
  type SendCodigoQrInvitationEmailParams,
} from '../services/codigos-qr.service.js';
import { codigosQrRepoPrisma } from '../services/codigos-qr.repo.prisma.js';
import { generateInviteToken } from '../lib/invitaciones.js';
import { cifrarTokenQr } from '../lib/codigos-qr.js';
import { SALT_ROUNDS } from '../lib/auth-fields.js';
import { requireJwtSecret } from '../lib/jwt.js';
import { isOrganizationSuspended } from '../lib/organization-status.js';
import { toPublicOrganizationBrand } from '../lib/serializers/organization.js';
import { resolveResetBrandingOrganizationIdForEmail } from '../controllers/auth.controller.js';
import {
  crearClub,
  listarClubes,
  cambiarEstadoClub,
  invitarAdminClub,
  type TenantsDeps,
  type TenantsRepo,
  type CrearClubInput,
} from '../services/tenants.service.js';
import { tenantsRepoPrisma } from '../services/tenants.repo.prisma.js';
import { computeDeclaracionHash } from '../lib/tenant-defaults.js';
import { getFileStorage } from '../lib/storage/get-file-storage.js';
import { buildObjectKey } from '../lib/storage/object-key.js';
import type { FileStorage } from '../lib/storage/file-storage.js';
import app from '../app.js';

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

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

// ─── Reporte ───────────────────────────────────────────────────────────────────

interface CheckResult {
  label: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ label, ok: true });
  } catch (err) {
    results.push({ label, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

function printReport(): void {
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
async function purgeOrganization(organizationId: string): Promise<void> {
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
    await prisma.membresia.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });
}

// Borra cualquier organización "iso-test-*" que haya quedado de una corrida
// anterior (crash) o de la corrida actual. Devuelve cuántas purgó.
async function purgeAllIsoTestOrganizations(): Promise<number> {
  const orgs = await runAsPlatform(() =>
    prisma.organization.findMany({ where: { slug: { startsWith: 'iso-test-' } }, select: { id: true } }),
  );
  for (const org of orgs) {
    await purgeOrganization(org.id);
  }
  return orgs.length;
}

async function countIsoTestOrganizations(): Promise<number> {
  return runAsPlatform(() => prisma.organization.count({ where: { slug: { startsWith: 'iso-test-' } } }));
}

// ─── Seed ──────────────────────────────────────────────────────────────────────

interface OrgSeed {
  organizationId: string;
  organizationName: string;
  adminUserId: string;
  adminEmail: string;
  membresiaAdminId: string;
  // Socio (no admin) con su propia ficha de Integrante en el mismo club — ver
  // el check de la biblioteca de documentos en runHttpChecks.
  socioUserId: string;
  socioEmail: string;
  integranteId: string;
  categoriaEventoId: number;
  gestorCategoriaId: number;
  declaracionVersionId: number;
  salidaId: string;
  cierreId: string;
  evaluacionTokenId: string;
  evaluacionRespuestaId: string;
  documentoId: string;
  eventoId: string;
  inscripcionId: string;
  notificacionId: string;
  dashboardLayoutId: string;
  invitacionId: string;
}

// Una fila de cada uno de los 15 modelos de tenant, con claves naturales
// COLISIONANTES entre A y B a propósito (mismo rut, slug, versión y
// numeroSalida) — si el aislamiento tuviera un agujero, esto lo expondría.
async function seedOrganization(label: 'A' | 'B', slug: string): Promise<OrgSeed> {
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

    const membresiaAdmin = await prisma.membresia.create({
      data: { organizationId: organization.id, usuarioId: adminUser.id, rol: 'ADMIN' },
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

    await prisma.membresia.create({
      data: { organizationId: organization.id, usuarioId: socioUser.id, rol: 'SOCIO' },
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
      membresiaAdminId: membresiaAdmin.id,
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

// ─── Verificaciones genéricas por modelo de tenant ────────────────────────────

interface CheckableDelegate {
  findMany(args: { where: Record<string, unknown> }): Promise<{ id: unknown }[]>;
  findUnique(args: { where: Record<string, unknown> }): Promise<{ id: unknown } | null>;
  findFirst(args: { where: Record<string, unknown> }): Promise<{ id: unknown } | null>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
}

function asCheckable(delegate: unknown): CheckableDelegate {
  return delegate as CheckableDelegate;
}

interface ModelProbe {
  name: string;
  delegate: CheckableDelegate;
  idA: string | number;
  idB: string | number;
  // Payload mínimo y neutro para un update — nunca llega a persistirse en
  // estos checks (siempre se dispara sobre el id de B desde el contexto de A,
  // que siempre debe fallar antes de tocar la fila).
  updateProbe: Record<string, unknown>;
  // Filas totales que el club A debe tener de este modelo (default 1).
  // Integrante ahora seedea una fila extra (el socio "de biblioteca" — ver
  // seedOrganization), así que declara 2 explícitamente.
  rowCount?: number;
}

function buildProbes(seedA: OrgSeed, seedB: OrgSeed): ModelProbe[] {
  return [
    {
      name: 'Membresia',
      delegate: asCheckable(prisma.membresia),
      idA: seedA.membresiaAdminId,
      idB: seedB.membresiaAdminId,
      updateProbe: { rol: 'SOCIO' },
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

async function runProbeChecks(probe: ModelProbe, orgAId: string, orgBId: string): Promise<void> {
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
    await assert.rejects(() =>
      runWithOrganization(orgAId, () => delegate.update({ where: { id: idB }, data: updateProbe })),
    );
    const stillThere = await runAsPlatform(() => delegate.findUnique({ where: { id: idB } }));
    assert.notEqual(stillThere, null);
  });

  await check(`${name}.delete por el id de B bajo A lanza y la fila de B sigue existiendo`, async () => {
    await assert.rejects(() => runWithOrganization(orgAId, () => delegate.delete({ where: { id: idB } })));
    const stillThere = await runAsPlatform(() => delegate.findUnique({ where: { id: idB } }));
    assert.notEqual(stillThere, null);
  });

  await check(`${name}.updateMany filtrado por el id de B bajo A afecta 0 filas`, async () => {
    const result = await runWithOrganization(orgAId, () =>
      delegate.updateMany({ where: { id: idB }, data: updateProbe }),
    );
    assert.equal(result.count, 0);
  });

  await check(`${name}.deleteMany filtrado por el id de B bajo A afecta 0 filas`, async () => {
    const result = await runWithOrganization(orgAId, () => delegate.deleteMany({ where: { id: idB } }));
    assert.equal(result.count, 0);
  });

  await check(`${name}.create con organizationId de B bajo el contexto de A lanza`, async () => {
    await assert.rejects(() =>
      runWithOrganization(orgAId, () => delegate.create({ data: { organizationId: orgBId } })),
    );
  });
}

// ─── Verificaciones transversales (transacciones, Organization, clave compuesta) ─

async function runCrossCuttingChecks(seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  await check('una consulta sin ningún contexto de tenant lanza', async () => {
    await assert.rejects(() => prisma.salida.findMany());
  });

  await check('transacción interactiva bajo A: tx.salida solo ve las filas de A', async () => {
    await runWithOrganization(seedA.organizationId, () =>
      prisma.$transaction(async (tx) => {
        const rows = await tx.salida.findMany({});
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, seedA.salidaId);

        const other = await tx.salida.findUnique({ where: { id: seedB.salidaId } });
        assert.equal(other, null);
      }),
    );
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
      await assert.rejects(
        async () => prisma.organization.findUnique({ where: { id: seedB.organizationId } }),
        { name: 'TenantContextError' },
      );

      const own = await prisma.organization.findUnique({ where: { id: seedA.organizationId } });
      assert.equal(own?.id, seedA.organizationId);
    });
  });

  await check('runAsPlatform ve ambos clubes', async () => {
    const orgs = await runAsPlatform(() =>
      prisma.organization.findMany({
        where: { id: { in: [seedA.organizationId, seedB.organizationId] } },
      }),
    );
    assert.equal(orgs.length, 2);
  });

  await check(
    'Integrante.findUnique por clave compuesta (organizationId_rut) bajo A devuelve el integrante de A pese al RUT compartido',
    async () => {
      const integrante = await runWithOrganization(seedA.organizationId, () =>
        prisma.integrante.findUnique({
          where: { organizationId_rut: { organizationId: seedA.organizationId, rut: SHARED_RUT } },
        }),
      );
      assert.ok(integrante);
      assert.equal(integrante?.id, seedA.integranteId);
    },
  );

  await check(
    'Invitacion.usuarioId ya no es @unique: la MISMA cuenta puede aparecer como usuarioId en dos invitaciones de clubes distintos (Ruling 1 del plan de la PR de Joining)',
    async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const invA = await runAsPlatform(() =>
        prisma.invitacion.create({
          data: {
            organizationId: seedA.organizationId,
            email: `migracion-usuario-id-${RANDOM_SUFFIX}@iso-test.local`,
            rol: 'SOCIO',
            tokenHash: randomUUID().replace(/-/g, ''),
            expiresAt,
            invitadoPorId: seedA.adminUserId,
            usuarioId: seedA.adminUserId,
          },
        }),
      );
      const invB = await runAsPlatform(() =>
        prisma.invitacion.create({
          data: {
            organizationId: seedB.organizationId,
            email: `migracion-usuario-id-${RANDOM_SUFFIX}@iso-test.local`,
            rol: 'SOCIO',
            tokenHash: randomUUID().replace(/-/g, ''),
            expiresAt,
            invitadoPorId: seedB.adminUserId,
            // Antes de la migración de esta PR, este segundo create hubiera
            // fallado con P2002 (invitaciones_usuario_id_key): el mismo
            // usuarioId ya estaba en invA.
            usuarioId: seedA.adminUserId,
          },
        }),
      );

      assert.equal(invA.usuarioId, seedA.adminUserId);
      assert.equal(invB.usuarioId, seedA.adminUserId);

      await runAsPlatform(() =>
        prisma.invitacion.deleteMany({ where: { id: { in: [invA.id, invB.id] } } }),
      );
    },
  );
}

// ─── Verificaciones HTTP ───────────────────────────────────────────────────────

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error('No se pudo determinar el puerto del servidor de pruebas'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
    server.on('error', reject);
  });
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function getJson(baseUrl: string, token: string, urlPath: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${urlPath}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

// Como getJson, pero también expone los headers de respuesta — lo necesitan
// los checks de Cache-Control de las URLs firmadas (ver runFileDownloadChecks).
async function getRaw(
  baseUrl: string,
  token: string,
  urlPath: string,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${baseUrl}${urlPath}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body, headers: res.headers };
}

async function deleteJson(baseUrl: string, token: string, urlPath: string): Promise<{ status: number }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status };
}

// Sin token: usado por los dos endpoints públicos de invitaciones
// (/api/auth/invitaciones/consultar y /aceptar). Ninguno de los dos envía
// correo ni sube archivos.
async function postJson(baseUrl: string, urlPath: string, payload: unknown): Promise<{ status: number; body: unknown }> {
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
async function postJsonAuth(
  baseUrl: string,
  token: string,
  urlPath: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

// Como postJsonAuth, pero con method PATCH — lo necesita el check de cambio
// de rol (ver runRoleChangeMembresiaChecks), la primera vez que este archivo
// prueba PATCH /api/admin/users/:id/rol.
async function patchJsonAuth(
  baseUrl: string,
  token: string,
  urlPath: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

// Como getJson, pero con el header X-Club — lo necesitan los checks nuevos de
// resolución de club activo (ver runAuthMembershipChecks): antes de este PR,
// ningún check de esta suite necesitaba enviarlo.
async function getJsonWithClub(
  baseUrl: string,
  token: string,
  urlPath: string,
  xClub?: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (xClub !== undefined) headers['X-Club'] = xClub;
  const res = await fetch(`${baseUrl}${urlPath}`, { headers });
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

// Fecha calendario (YYYY-MM-DD) desplazada `dias` desde ahora — usada para
// armar la ficha del evento operativo del club nuevo (ver runTenantCliChecks)
// sin acoplarse a la fecha en que corra la suite.
function fechaEnDias(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function runHttpChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
  const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });

  await check('GET /api/salidas — cada admin ve solo la salida de su propio club', async () => {
    const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, '/api/salidas'), getJson(baseUrl, tokenB, '/api/salidas')]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    const salidasA = resA.body as { id: string }[];
    const salidasB = resB.body as { id: string }[];
    assert.equal(salidasA.length, 1);
    assert.equal(salidasA[0]?.id, seedA.salidaId);
    assert.equal(salidasB.length, 1);
    assert.equal(salidasB[0]?.id, seedB.salidaId);
  });

  await check('GET /api/salidas/<id de otro club> devuelve 404', async () => {
    const res = await getJson(baseUrl, tokenA, `/api/salidas/${seedB.salidaId}`);
    assert.equal(res.status, 404);
  });

  await check(
    'GET /api/me — cada admin ve la organización pública de SU PROPIO club (7 campos, sin datos privados)',
    async () => {
      const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, '/api/me'), getJson(baseUrl, tokenB, '/api/me')]);
      assert.equal(resA.status, 200);
      assert.equal(resB.status, 200);
      const orgA = (resA.body as { user: { organization?: Record<string, unknown> } }).user.organization;
      const orgB = (resB.body as { user: { organization?: Record<string, unknown> } }).user.organization;
      assert.ok(orgA);
      assert.ok(orgB);
      // Igualdad estricta a propósito: si algún día se filtra alertEmail,
      // contactEmail o la clave cruda del logo (logoObjectKey), esto falla.
      assert.deepEqual(Object.keys(orgA!).sort(), [
        'hasLogo', 'id', 'logoVersion', 'membresiaPropia', 'name', 'shortName', 'slug',
      ]);
      // Ningún club de este fixture subió un logo propio.
      assert.equal(orgA!.hasLogo, false);
      assert.equal(orgA!.logoVersion, null);
      assert.equal(orgA!.slug, SLUG_A);
      assert.equal(orgA!.membresiaPropia, MEMBRESIA_A);
      assert.equal(orgB!.slug, SLUG_B);
      assert.equal(orgB!.membresiaPropia, MEMBRESIA_B);
      assert.notEqual(orgA!.id, orgB!.id);
    },
  );

  await check('GET /api/admin/users — solo los usuarios del propio club (por Membresia desde este PR)', async () => {
    const res = await getJson(baseUrl, tokenA, '/api/admin/users');
    assert.equal(res.status, 200);
    const users = res.body as { email: string; rol: string }[];
    // 2: el admin y el socio "de biblioteca" seedeados en el club A.
    assert.equal(users.length, 2);
    const emails = users.map((u) => u.email);
    assert.ok(emails.includes(seedA.adminEmail));
    assert.ok(emails.includes(seedA.socioEmail));
    // User es global desde este PR (ver scope-args.ts): si listUsers volviera
    // a listar directo desde User en vez de Membresia, este assert lo
    // detectaría filtrando personas de OTRO club adentro de la lista de A.
    assert.ok(!emails.includes(seedB.adminEmail));
    assert.ok(!emails.includes(seedB.socioEmail));
  });

  await check('GET /api/admin/stats — los totales reflejan solo el club del que consulta (predicado SQL crudo)', async () => {
    const res = await getJson(baseUrl, tokenA, '/api/admin/stats');
    assert.equal(res.status, 200);
    const stats = res.body as { totalSalidas: number; porMes: { total: number }[] };
    assert.equal(stats.totalSalidas, 1);
    const sumaPorMes = stats.porMes.reduce((acc, r) => acc + r.total, 0);
    assert.equal(sumaPorMes, 1);
  });

  await check('GET /api/invitaciones — solo las propias', async () => {
    const res = await getJson(baseUrl, tokenA, '/api/invitaciones');
    assert.equal(res.status, 200);
    const body = res.body as { invitaciones: { id: string }[] };
    assert.equal(body.invitaciones.length, 1);
    assert.equal(body.invitaciones[0]?.id, seedA.invitacionId);
  });

  await check('GET /api/documentos/admin — solo los propios', async () => {
    const res = await getJson(baseUrl, tokenA, '/api/documentos/admin');
    assert.equal(res.status, 200);
    const documentos = res.body as { id: string }[];
    assert.equal(documentos.length, 1);
    assert.equal(documentos[0]?.id, seedA.documentoId);
  });

  await check('GET /api/eventos — solo los propios', async () => {
    const res = await getJson(baseUrl, tokenA, '/api/eventos');
    assert.equal(res.status, 200);
    const eventos = res.body as { id: string }[];
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0]?.id, seedA.eventoId);
  });

  await check('GET /api/integrantes/by-rut/<rut compartido> — cada club obtiene SU PROPIO integrante', async () => {
    const path = `/api/integrantes/by-rut/${encodeURIComponent(SHARED_RUT)}`;
    const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, path), getJson(baseUrl, tokenB, path)]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    const integranteA = resA.body as { email: string };
    const integranteB = resB.body as { email: string };
    assert.notEqual(integranteA.email, integranteB.email);
  });

  const tokenSocioA = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
  const tokenSocioB = signToken({ userId: seedB.socioUserId, email: seedB.socioEmail });

  await check('GET /api/documentos — el socio de A (membresía propia de A) ve la biblioteca', async () => {
    const res = await getJson(baseUrl, tokenSocioA, '/api/documentos');
    assert.equal(res.status, 200);
  });

  await check(
    'GET /api/documentos — el socio de B con la MISMA afiliación (membresía de A) recibe 403 nombrando a SU club',
    async () => {
      const res = await getJson(baseUrl, tokenSocioB, '/api/documentos');
      assert.equal(res.status, 403);
      const body = res.body as { error: string };
      assert.match(body.error, new RegExp(seedB.organizationName));
    },
  );

  // ─── Marca pública en pantallas sin sesión (branding por club) ────────────────

  await check(
    'POST /api/auth/invitaciones/consultar expone la marca del club que invita (slug/name/shortName, nunca datos privados)',
    async () => {
      const email = `consultar-brand-${RANDOM_SUFFIX}@iso-test.local`;
      const creada = await postJsonAuth(baseUrl, tokenA, '/api/invitaciones', { email, rol: 'SOCIO' });
      assert.equal(creada.status, 201);
      const inviteUrl = (creada.body as { inviteUrl: string }).inviteUrl;
      const token = inviteUrl.split('#invite=')[1] ?? '';
      assert.ok(token.length > 0);

      const consultada = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token });
      assert.equal(consultada.status, 200);
      const body = consultada.body as { organization?: Record<string, unknown> };
      assert.ok(body.organization);
      assert.deepEqual(Object.keys(body.organization!).sort(), [
        'hasLogo', 'logoVersion', 'name', 'shortName', 'slug',
      ]);
      assert.equal(body.organization!.hasLogo, false);
      assert.equal(body.organization!.logoVersion, null);
      assert.equal(body.organization!.slug, SLUG_A);
      assert.equal(body.organization!.name, seedA.organizationName);
    },
  );

  await check(
    'GET /api/evaluaciones/:token expone la marca del club dueño de la evaluación (slug/name/shortName)',
    async () => {
      const token = `iso-test-eval-a-${RANDOM_SUFFIX}`;
      const res = await fetch(`${baseUrl}/api/evaluaciones/${token}`);
      const body = (await res.json().catch(() => undefined)) as { organization?: Record<string, unknown> } | undefined;
      assert.equal(res.status, 200);
      assert.ok(body?.organization);
      assert.deepEqual(Object.keys(body!.organization!).sort(), [
        'hasLogo', 'logoVersion', 'name', 'shortName', 'slug',
      ]);
      assert.equal(body!.organization!.hasLogo, false);
      assert.equal(body!.organization!.logoVersion, null);
      assert.equal(body!.organization!.slug, SLUG_A);
    },
  );

  // ─── Invitaciones emitidas por la plataforma (bootstrap del primer ADMIN) ───
  // Repositorio real (Prisma) + email falso (nunca contacta Gmail): no hay
  // endpoint HTTP para crearlas todavía (llegará con el CLI de una fase
  // posterior), así que se llama al servicio directo, ya envuelto en el
  // contexto de club correspondiente — igual que hará ese CLI.
  const fakeInvitacionDeps: InvitacionesDeps = {
    repo: invitacionesRepoPrisma,
    sendEmail: async () => {},
    hashPassword: async (password) => `hashed:${password}`,
    // Fake consistente con el hashPassword de arriba (nunca se usa bcrypt
    // real acá — mismo motivo que hashPassword: esta invitación de
    // plataforma nunca pasa por el flujo HTTP de aceptar).
    comparePassword: async (password, hash) => hash === `hashed:${password}`,
    now: () => new Date(),
    frontendUrl: 'https://iso-test.local',
  };

  await check(
    'invitación de plataforma para el club A: crear → consultar (etiqueta de plataforma) → aceptar crea un ADMIN verificado',
    async () => {
      const email = `platform-admin-${RANDOM_SUFFIX}@iso-test.local`;
      const creada = await runWithOrganization(seedA.organizationId, () =>
        crearInvitacionPlataforma(fakeInvitacionDeps, { organizationId: seedA.organizationId, email, rol: 'ADMIN' }),
      );
      assert.equal(creada.ok, true);
      if (!creada.ok) return;
      assert.equal(creada.body.invitacion.invitadoPor, null);
      assert.equal(creada.body.invitacion.emitidaPorPlataforma, true);

      const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';
      assert.ok(token.length > 0);

      const consultada = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token });
      assert.equal(consultada.status, 200);
      const consultadaBody = consultada.body as { invitadoPor: string; rol: string };
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

      const membresia = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: creado!.id } },
        }),
      );
      assert.ok(membresia);
      assert.equal(membresia?.rol, 'ADMIN');
    },
  );

  await check('el admin de B no ve por HTTP una invitación de plataforma emitida para A', async () => {
    const email = `platform-oculta-${RANDOM_SUFFIX}@iso-test.local`;
    const creada = await runWithOrganization(seedA.organizationId, () =>
      crearInvitacionPlataforma(fakeInvitacionDeps, { organizationId: seedA.organizationId, email, rol: 'SOCIO' }),
    );
    assert.equal(creada.ok, true);

    const res = await getJson(baseUrl, tokenB, '/api/invitaciones');
    assert.equal(res.status, 200);
    const body = res.body as { invitaciones: { email: string }[] };
    assert.equal(body.invitaciones.some((i) => i.email === email), false);
  });

  await check(
    'dos invitaciones pendientes para el mismo correo: la transacción que pierde la carrera de User.email no deja una Membresia huérfana',
    async () => {
      const email = `race-invite-${RANDOM_SUFFIX}@iso-test.local`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const invitacion1 = await runAsPlatform(() =>
        prisma.invitacion.create({
          data: {
            organizationId: seedA.organizationId,
            email,
            rol: 'SOCIO',
            tokenHash: randomUUID().replace(/-/g, ''),
            expiresAt,
            invitadoPorId: seedA.adminUserId,
          },
        }),
      );
      const invitacion2 = await runAsPlatform(() =>
        prisma.invitacion.create({
          data: {
            organizationId: seedA.organizationId,
            email,
            rol: 'LIDER',
            tokenHash: randomUUID().replace(/-/g, ''),
            expiresAt,
            invitadoPorId: seedA.adminUserId,
          },
        }),
      );

      // acceptInvitacion corre siempre dentro de runAsPlatform en producción
      // (así lo invoca el controller en aceptarInvitacion) — acá se preserva
      // ese mismo contexto para las dos llamadas directas y concurrentes.
      const [primero, segundo] = await runAsPlatform(() =>
        Promise.all([
          invitacionesRepoPrisma.acceptInvitacion({
            invitacionId: invitacion1.id,
            organizationId: seedA.organizationId,
            email,
            name: 'Primero',
            passwordHash: 'hashed:primero',
            rol: 'SOCIO',
            now,
          }),
          invitacionesRepoPrisma.acceptInvitacion({
            invitacionId: invitacion2.id,
            organizationId: seedA.organizationId,
            email,
            name: 'Segundo',
            passwordHash: 'hashed:segundo',
            rol: 'LIDER',
            now,
          }),
        ]),
      );

      // Exactamente una de las dos transacciones gana la carrera del unique
      // de User.email; la otra vuelve null (ver el catch de P2002 en
      // invitaciones.repo.prisma.ts) sin dejar rastro.
      const ganadores = [primero, segundo].filter((r) => r !== null);
      assert.equal(ganadores.length, 1);

      const creado = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      assert.ok(creado);

      const membresias = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: creado!.id } }));
      // Si el dual write viviera fuera de la transacción de Prisma, este
      // assert es el que lo detectaría: una Membresia "huérfana" de la
      // transacción que perdió la carrera de User.email.
      assert.equal(membresias.length, 1);
      assert.equal(membresias[0]?.rol, creado?.rol);
    },
  );

  // ─── Puente multi-club: la membresía de una ficha nueva la decide el servidor ──
  // El formulario de registro ya no pregunta a qué club dice pertenecer la
  // persona (esa pregunta se eliminó): toda ficha nueva es socia del club
  // donde se crea, y el body puede traer membresiaClub/nombreClub de un
  // frontend cacheado o de un cliente malicioso — el servidor debe ignorarlos
  // siempre (ver membresiaParaNuevaFicha en lib/integrante-membresia.ts).
  await check(
    'POST /api/integrantes — la membresía de una ficha nueva es SIEMPRE la propia del club, aunque el body envíe la de otro',
    async () => {
      const fichaPayload = (rut: string, email: string) => ({
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
      const fichaA = resA.body as { membresiaClub: string; nombreClub: string | null };
      const fichaB = resB.body as { membresiaClub: string; nombreClub: string | null };
      assert.equal(fichaA.membresiaClub, MEMBRESIA_A);
      assert.equal(fichaA.nombreClub, null);
      assert.equal(fichaB.membresiaClub, MEMBRESIA_B);
      assert.equal(fichaB.nombreClub, null);
    },
  );

  await check('suspender el club B: su token pasa a 403 y el club A sigue en 200', async () => {
    await runAsPlatform(() =>
      prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'SUSPENDED' } }),
    );
    const [resA, resB] = await Promise.all([getJson(baseUrl, tokenA, '/api/salidas'), getJson(baseUrl, tokenB, '/api/salidas')]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 403);
  });
}

// ─── QR reusable del club ───────────────────────────────────────────────────────

function buildFakeCodigosQrDeps(capturedEmails: SendCodigoQrInvitationEmailParams[]): CodigosQrDeps {
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
      if (!org) return null;
      return { brand: toPublicOrganizationBrand(org), suspended: isOrganizationSuspended(org.status) };
    },
    withOrganization: (organizationId, fn) => runWithOrganization(organizationId, fn),
    hashPassword: (password) => bcrypt.hash(password, SALT_ROUNDS),
    // Repositorio real por debajo (codigosQrRepoPrisma), así que la
    // comparación también debe ser real bcrypt — no el fake de arriba.
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
    now: () => new Date(),
    frontendUrl: 'https://iso-test.local',
    jwtSecret: requireJwtSecret(),
    logError: () => {},
  };
}

async function runQrChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  // El último paso de runHttpChecks deja a B en SUSPENDED a propósito; esta
  // sección necesita a B respondiendo con normalidad para sus propios checks
  // de aislamiento (listar/ver/revocar el código de A) — mismo motivo y mismo
  // patrón que runFileDownloadChecks más abajo.
  await runAsPlatform(() =>
    prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'ACTIVE' } }),
  );

  const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
  const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });

  let qrIdA = '';
  let qrTokenA = '';

  await check(
    'ADMIN A crea un QR reusable y GET /api/qr/consultar expone la marca de SU club',
    async () => {
      const creado = await postJsonAuth(baseUrl, tokenA, '/api/invitaciones/qr', {
        duracion: '24h',
        // 4, no 3: desde la PR "Joining", solicitar con el email de una
        // cuenta existente en OTRO club también mintea (ver el check
        // "solicitar de nuevo..." más abajo) — un uso más que antes de esa
        // PR, para que el check de revocación al final de esta función siga
        // encontrando el código ACTIVO (usosRestantes > 0) tal como asumía.
        maxUsos: 4,
        etiqueta: `iso-test-qr-${RANDOM_SUFFIX}`,
      });
      assert.equal(creado.status, 201);
      const body = creado.body as { codigo: { id: string; usosRestantes: number }; qrUrl: string };
      qrIdA = body.codigo.id;
      qrTokenA = body.qrUrl.split('#qr=')[1] ?? '';
      assert.ok(qrTokenA.length > 0);
      assert.equal(body.codigo.usosRestantes, 4);

      const consultado = await postJson(baseUrl, '/api/qr/consultar', { token: qrTokenA });
      assert.equal(consultado.status, 200);
      const consultadoBody = consultado.body as { organization: { slug: string }; expiresAt: string };
      assert.equal(consultadoBody.organization.slug, SLUG_A);
    },
  );

  const emailNuevoQr = `qr-nuevo-${RANDOM_SUFFIX}@iso-test.local`;

  await check(
    'POST /api/qr/solicitar con un email nuevo mintea una Invitacion SOCIO en A y decrementa usosRestantes',
    async () => {
      const solicitado = await postJson(baseUrl, '/api/qr/solicitar', { token: qrTokenA, email: emailNuevoQr });
      assert.equal(solicitado.status, 202);
      assert.equal((solicitado.body as { message: string }).message, MENSAJE_SOLICITUD_GENERICA);

      const invitacion = await runAsPlatform(() => prisma.invitacion.findFirst({ where: { email: emailNuevoQr } }));
      assert.ok(invitacion);
      assert.equal(invitacion?.organizationId, seedA.organizationId);
      assert.equal(invitacion?.rol, 'SOCIO');
      assert.equal(invitacion?.invitadoPorId, seedA.adminUserId);
      assert.equal(invitacion?.codigoQrId, qrIdA);

      const listado = await getJson(baseUrl, tokenA, '/api/invitaciones/qr');
      assert.equal(listado.status, 200);
      const codigos = (listado.body as { codigos: { id: string; usosRestantes: number }[] }).codigos;
      const propio = codigos.find((c) => c.id === qrIdA);
      assert.equal(propio?.usosRestantes, 3);
    },
  );

  await check(
    'solicitar de nuevo con el MISMO email da la misma respuesta 202 sin nueva fila (ya pendiente); con el email de un ADMIN existente de OTRO club SÍ mintea (Ruling 6 de la PR "Joining")',
    async () => {
      const repetida = await postJson(baseUrl, '/api/qr/solicitar', { token: qrTokenA, email: emailNuevoQr });
      const conCuentaExistente = await postJson(baseUrl, '/api/qr/solicitar', { token: qrTokenA, email: seedB.adminEmail });
      assert.deepEqual(repetida, { status: 202, body: { message: MENSAJE_SOLICITUD_GENERICA } });
      assert.deepEqual(conCuentaExistente, { status: 202, body: { message: MENSAJE_SOLICITUD_GENERICA } });

      const invitacionesEmailRepetido = await runAsPlatform(() =>
        prisma.invitacion.findMany({ where: { email: emailNuevoQr } }),
      );
      assert.equal(invitacionesEmailRepetido.length, 1);
      // Desde la PR "Joining", una cuenta existente en OTRO club deja de ser
      // silenciosa acá: el QR reusable de A mintea una invitación para ella
      // igual que para un email nuevo (el 202 público no lo revela, pero la
      // fila sí queda — ver Ruling 6 del plan de esa PR). usosRestantes de
      // qrIdA baja uno más de lo que bajaba antes de esa PR (ver el
      // comentario en maxUsos, arriba).
      const invitacionEmailAdminB = await runAsPlatform(() =>
        prisma.invitacion.findFirst({ where: { email: seedB.adminEmail } }),
      );
      assert.ok(invitacionEmailAdminB);
      assert.equal(invitacionEmailAdminB?.organizationId, seedA.organizationId);
      assert.equal(invitacionEmailAdminB?.rol, 'SOCIO');
      assert.equal(invitacionEmailAdminB?.invitadoPorId, seedA.adminUserId);
      assert.equal(invitacionEmailAdminB?.codigoQrId, qrIdA);
    },
  );

  await check('el admin de B no puede listar/ver/revocar el código QR de A (404, sin revelar existencia)', async () => {
    const verDesdeB = await getJson(baseUrl, tokenB, `/api/invitaciones/qr/${qrIdA}`);
    assert.equal(verDesdeB.status, 404);

    const revocarDesdeB = await postJsonAuth(baseUrl, tokenB, `/api/invitaciones/qr/${qrIdA}/revocar`, {});
    assert.equal(revocarDesdeB.status, 404);

    const listadoB = await getJson(baseUrl, tokenB, '/api/invitaciones/qr');
    assert.equal(listadoB.status, 200);
    const codigosB = (listadoB.body as { codigos: { id: string }[] }).codigos;
    assert.equal(codigosB.some((c) => c.id === qrIdA), false);
  });

  await check('un token de QR en /api/auth/invitaciones/consultar (invitación individual) da 404', async () => {
    const res = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token: qrTokenA });
    assert.equal(res.status, 404);
  });

  await check(
    'aceptar una invitación minteada por el QR de A, por HTTP, crea al usuario como SOCIO de A y permite iniciar sesión',
    async () => {
      const capturedEmails: SendCodigoQrInvitationEmailParams[] = [];
      const email = `qr-aceptada-${RANDOM_SUFFIX}@iso-test.local`;
      const resultado = await runAsPlatform(() =>
        solicitarInvitacionQrService(buildFakeCodigosQrDeps(capturedEmails), qrTokenA, { email }),
      );
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
      const org = (login.body as { user: { organization?: { slug: string } } }).user.organization;
      assert.equal(org?.slug, SLUG_A);
    },
  );

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
    const token = (creado.body as { qrUrl: string }).qrUrl.split('#qr=')[1] ?? '';

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
    await runAsPlatform(() =>
      prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'SUSPENDED' } }),
    );

    try {
      const { token, tokenHash } = generateInviteToken();
      await runAsPlatform(() =>
        prisma.codigoQrInvitacion.create({
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
        }),
      );

      const solicitado = await postJson(baseUrl, '/api/qr/solicitar', {
        token,
        email: `qr-suspendido-${RANDOM_SUFFIX}@iso-test.local`,
      });
      assert.equal(solicitado.status, 410);
    } finally {
      await runAsPlatform(() =>
        prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'ACTIVE' } }),
      );
    }
  });
}

// ─── QR directo ("QR directo" — registro en el acto, sin correo) ──────────────
// runQrChecks deja a B de vuelta ACTIVE al terminar (try/finally de su último
// check), así que esta sección no necesita reactivarlo ella misma.

async function runQrDirectoChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
  const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });

  let qrIdA = '';
  let qrTokenA = '';

  await check('ADMIN A crea un QR directo: modo DIRECTO, 1 uso', async () => {
    const creado = await postJsonAuth(baseUrl, tokenA, '/api/invitaciones/qr', { modo: 'DIRECTO' });
    assert.equal(creado.status, 201);
    const body = creado.body as {
      codigo: { id: string; modo: string; maxUsos: number; usosRestantes: number };
      qrUrl: string;
    };
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
    const tokenCorreo = (creadoCorreo.body as { qrUrl: string }).qrUrl.split('#qr=')[1] ?? '';

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
    const body = res.body as { estado: string; registrado: unknown };
    assert.equal(body.estado, 'ACTIVO');
    assert.equal(body.registrado, null);
  });

  await check(
    'registrar con el email de una cuenta existente ya no da 409 (PR "Joining"): sin contraseña real que probar (seedA.socioEmail no tiene passwordHash), da 401 y NO consume el uso',
    async () => {
      const res = await postJson(baseUrl, '/api/qr/registrar', {
        token: qrTokenA,
        name: 'Ya Existe',
        email: seedA.socioEmail,
        password: 'password123',
      });
      // seedOrganization nunca le fija passwordHash al socio sembrado: es un
      // mismatch garantizado (Ruling 3 del plan de la PR de Joining), así
      // que cualquier contraseña enviada da 401, nunca 200/410 — ver
      // runQrDirectoJoiningChecks más abajo para el camino con una
      // contraseña real.
      assert.equal(res.status, 401);

      const estado = await getJson(baseUrl, tokenA, `/api/invitaciones/qr/${qrIdA}/estado`);
      assert.equal((estado.body as { estado: string }).estado, 'ACTIVO');
    },
  );

  const emailNuevo = `qr-directo-nuevo-${RANDOM_SUFFIX}@iso-test.local`;

  await check(
    'registrar con el QR directo de A crea un SOCIO verificado en A, en el acto, que puede iniciar sesión',
    async () => {
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

      const membresia = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: creado!.id } },
        }),
      );
      assert.ok(membresia);
      assert.equal(membresia?.rol, 'SOCIO');

      const login = await postJson(baseUrl, '/api/auth/login', { email: emailNuevo, password: 'password123' });
      assert.equal(login.status, 200);
      const org = (login.body as { user: { organization?: { slug: string } } }).user.organization;
      assert.equal(org?.slug, SLUG_A);
    },
  );

  await check('el panel de quien invitó ve AGOTADO con el nombre/email de quien se registró', async () => {
    const res = await getJson(baseUrl, tokenA, `/api/invitaciones/qr/${qrIdA}/estado`);
    assert.equal(res.status, 200);
    const body = res.body as { estado: string; registrado: { name: string; email: string } | null };
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
    const codigos = (listado.body as { codigos: { id: string }[] }).codigos;
    assert.equal(codigos.some((c) => c.id === qrIdA), false);
  });
}

// ─── Descargas firmadas entre clubes (Fase 6: storage en Google Cloud Storage) ──
// Esta sección corre DESPUÉS de runHttpChecks a propósito: muta el evento
// sembrado (BORRADOR → PUBLICADO, con fechas) para poder probar la URL
// firmada de su itinerario con una fila "visible para socios", y ese cambio
// no debe interferir con ningún check anterior que asuma el estado original.

// Superficie mínima que necesitamos inspeccionar del storage — el mismo
// patrón "duck typing" que CheckableDelegate más arriba en este archivo.
interface InspectableStorage extends FileStorage {
  has(key: string): boolean;
  keys(): string[];
}

// La suite jamás debe escribir en un bucket real: getFileStorage() debe
// resolver al adaptador de memoria (la suite corre sin STORAGE_PROVIDER=gcs
// ni variables GCS_*). Lanza en vez de continuar en silencio.
function assertMemoryStorage(): InspectableStorage {
  const storage = getFileStorage();
  const candidate = storage as Partial<InspectableStorage>;
  if (typeof candidate.has !== 'function' || typeof candidate.keys !== 'function') {
    throw new Error(
      'getFileStorage() no resolvió al adaptador de memoria: esta sección jamás debe correr contra un bucket ' +
        'real. main() fuerza STORAGE_PROVIDER=memory al arrancar; si ves este error, algo resolvió ' +
        'getFileStorage() antes de ese punto.',
    );
  }
  return storage as InspectableStorage;
}

interface OrgFileSeed {
  gpxKey: string;
  pronosticoKey: string;
  documentoKey: string;
  itinerarioKey: string;
}

// Extiende (nunca duplica) las filas ya sembradas por seedOrganization: la
// salida, el documento y el evento existentes ganan claves de objeto REALES
// (construidas con buildObjectKey para el organizationId del propio club) y
// un objeto chico correspondiente en el storage — así los checks de más abajo
// (URL firmada, huérfanos borrados) verifican comportamiento real, no solo
// strings sueltos.
async function seedFilesForOrg(storage: InspectableStorage, seed: OrgSeed): Promise<OrgFileSeed> {
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
async function seedMismatchDocumento(orgBId: string, orgAId: string): Promise<string> {
  const foreignKey = buildObjectKey({ organizationId: orgAId, kind: 'documento', extension: 'pdf' });
  const documento = await runAsPlatform(() =>
    prisma.documento.create({
      data: {
        organizationId: orgBId,
        categoria: 'OTRO',
        nombre: 'Documento mismatch iso-test',
        driveFileId: foreignKey,
      },
    }),
  );
  return documento.id;
}

// Fila legada: id sin forma de clave de objeto (como un fileId de Drive) más
// una URL legada — ejercita la rama "legacy" de resolveFileDownload.
async function seedLegacyDocumento(orgAId: string, legacyUrl: string): Promise<string> {
  const documento = await runAsPlatform(() =>
    prisma.documento.create({
      data: {
        organizationId: orgAId,
        categoria: 'OTRO',
        nombre: 'Documento legado iso-test',
        driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
        driveFileUrl: legacyUrl,
      },
    }),
  );
  return documento.id;
}

async function runFileDownloadChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const storage = assertMemoryStorage();

  // El último check de runHttpChecks deja al club B en SUSPENDED (a
  // propósito, para probar esa regla) y nada más lo reactiva. Esta sección
  // necesita a AMBOS clubes respondiendo con normalidad — si no, cualquier
  // 403 de suspensión se confundiría con un 404 de aislamiento. No se toca
  // ni se reordena el check de suspensión de runHttpChecks: se revierte acá.
  await runAsPlatform(() =>
    prisma.organization.update({ where: { id: seedB.organizationId }, data: { status: 'ACTIVE' } }),
  );

  const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
  const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });

  // Precondición explícita: si la reactivación fallara (o algo la revirtiera
  // más adelante), este check nombra la causa real en vez de que aparezcan
  // seis 403 inexplicables disfrazados de fallos de aislamiento.
  await check('club B reactivado: su token vuelve a responder 200 en un endpoint autenticado', async () => {
    const res = await getRaw(baseUrl, tokenB, '/api/salidas');
    assert.equal(res.status, 200);
  });

  let filesA: OrgFileSeed | undefined;
  let filesB: OrgFileSeed | undefined;
  let mismatchDocId: string | undefined;
  let legacyDocId: string | undefined;
  const LEGACY_URL = 'https://legacy-storage.example/documento/legado.pdf';

  try {
    filesA = await seedFilesForOrg(storage, seedA);
    filesB = await seedFilesForOrg(storage, seedB);
    mismatchDocId = await seedMismatchDocumento(seedB.organizationId, seedA.organizationId);
    legacyDocId = await seedLegacyDocumento(seedA.organizationId, LEGACY_URL);

    // ── Camino feliz: cada club obtiene su propia URL firmada (simétrico: ──────
    // B ahora está activo y también debe poder firmar las suyas — al menos
    // salida/gpx y documento, para no duplicar la cobertura completa de A).
    const ownPathChecks: { label: string; token: string; org: OrgSeed; path: string }[] = [
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
        const body = res.body as { url: string; expiresInSeconds: number | null };
        assert.equal(body.expiresInSeconds, 600);
        assert.ok(
          body.url.includes(`orgs/${org.organizationId}/`),
          `la URL firmada debía incluir el prefijo del propio club: ${body.url}`,
        );
        assert.equal(res.headers.get('cache-control'), 'no-store');
      });
    }

    await check('GET /api/salidas/:id/archivos/:tipo/url — tipo fuera de gpx|pronostico responde 400', async () => {
      const res = await getRaw(baseUrl, tokenA, `/api/salidas/${seedA.salidaId}/archivos/otro/url`);
      assert.equal(res.status, 400);
    });

    // ── Entre clubes: B nunca ve los archivos de A, sin filtrar datos de A ─────
    const crossPathChecks: { label: string; path: string }[] = [
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
          filesA!.gpxKey,
          filesA!.pronosticoKey,
          filesA!.documentoKey,
          filesA!.itinerarioKey,
        ]) {
          assert.equal(raw.includes(leaked), false, `la respuesta filtró "${leaked}"`);
        }
      });
    }

    await check(
      'GET /api/salidas/:id/archivos/gpx/url — en la otra dirección (token de A sobre la salida de B) también 404',
      async () => {
        const res = await getRaw(baseUrl, tokenA, `/api/salidas/${seedB.salidaId}/archivos/gpx/url`);
        assert.equal(res.status, 404);
        const raw = JSON.stringify(res.body);
        assert.equal(raw.includes(seedB.organizationId), false);
        assert.equal(raw.includes(filesB!.gpxKey), false);
      },
    );

    // ── Defensa en profundidad: clave de A guardada (a mano) en una fila de B ──
    await check('GET /api/documentos/:id/url — una clave de A en una fila de B nunca firma: 404', async () => {
      const res = await getRaw(baseUrl, tokenB, `/api/documentos/${mismatchDocId}/url`);
      assert.equal(res.status, 404);
      const raw = JSON.stringify(res.body);
      assert.equal(raw.includes(seedA.organizationId), false);
    });

    // ── Fila legada: la URL de Drive sigue funcionando, pero solo para su club ─
    await check(
      'GET /api/documentos/:id/url — fila legada de A responde la URL legada (expiresInSeconds: null)',
      async () => {
        const res = await getRaw(baseUrl, tokenA, `/api/documentos/${legacyDocId}/url`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { url: LEGACY_URL, expiresInSeconds: null });
      },
    );

    await check('GET /api/documentos/:id/url — la fila legada de A es 404 para B', async () => {
      const res = await getRaw(baseUrl, tokenB, `/api/documentos/${legacyDocId}/url`);
      assert.equal(res.status, 404);
    });

    // ── Los listados/detalles nunca filtran una columna *FileUrl ───────────────
    const noUrlLeakChecks: { label: string; path: string }[] = [
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
      assert.equal(storage.has(filesA!.gpxKey), true);
      assert.equal(storage.has(filesA!.pronosticoKey), true);

      const res = await deleteJson(baseUrl, tokenA, `/api/salidas/${seedA.salidaId}`);
      assert.equal(res.status, 204);

      assert.equal(storage.has(filesA!.gpxKey), false);
      assert.equal(storage.has(filesA!.pronosticoKey), false);
      assert.equal(storage.has(filesB!.gpxKey), true);
      assert.equal(storage.has(filesB!.pronosticoKey), true);
    });
  } finally {
    // Limpieza propia de esta sección — no depende del purgeOrganization final
    // de main() para dejar la base y el storage exactamente como los encontró.
    const extraDocIds = [mismatchDocId, legacyDocId].filter((id): id is string => Boolean(id));
    if (extraDocIds.length > 0) {
      await runAsPlatform(() => prisma.documento.deleteMany({ where: { id: { in: extraDocIds } } })).catch(
        (err) => console.error('[test-isolation] No se pudieron limpiar las filas extra de documentos:', err),
      );
    }

    const leftoverKeys = [
      filesA?.documentoKey,
      filesA?.itinerarioKey,
      filesB?.gpxKey,
      filesB?.pronosticoKey,
      filesB?.documentoKey,
      filesB?.itinerarioKey,
    ].filter((key): key is string => Boolean(key));
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
async function runClubLogoChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const storage = assertMemoryStorage();
  const socioTokenA = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
  const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });

  const marca = async (slug: string) => {
    const res = await fetch(`${baseUrl}/api/clubes/${slug}/marca`);
    const body = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
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
  await runAsPlatform(() =>
    prisma.organization.update({ where: { id: seedA.organizationId }, data: { logoObjectKey: logoKeyA } }),
  );

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
    assert.deepEqual(Object.keys(a.body!).sort(), ['hasLogo', 'logoVersion', 'name', 'shortName', 'slug']);
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

async function runTenantCliChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const cliSlug = `iso-test-cli-${RANDOM_SUFFIX}`;
  const cliAdminEmail = `admin-cli-${RANDOM_SUFFIX}@iso-test.local`;
  const cliSocioEmail = `socio-cli-${RANDOM_SUFFIX}@iso-test.local`;
  const cliReinviteEmail = `reinvite-admin-cli-${RANDOM_SUFFIX}@iso-test.local`;
  const CLI_PASSWORD = 'password123';

  // Repositorio real + invitación de plataforma con correo falso (nunca
  // contacta Gmail/SMTP) — mismo patrón que fakeInvitacionDeps más arriba,
  // pero envuelto por tenants.service.ts en vez de llamado directo.
  const fakeInvitacionDepsCli: InvitacionesDeps = {
    repo: invitacionesRepoPrisma,
    sendEmail: async () => {},
    hashPassword: async (password) => `hashed:${password}`,
    comparePassword: async (password, hash) => hash === `hashed:${password}`,
    now: () => new Date(),
    frontendUrl: 'https://iso-test-cli.local',
  };
  const crearInvitacionAdminFake: TenantsDeps['crearInvitacionAdmin'] = (organizationId, email) =>
    runWithOrganization(organizationId, () =>
      crearInvitacionPlataforma(fakeInvitacionDepsCli, { organizationId, email, rol: 'ADMIN' }),
    );

  const depsOperativos: TenantsDeps = {
    repo: tenantsRepoPrisma,
    crearInvitacionAdmin: crearInvitacionAdminFake,
    now: () => new Date(),
  };

  const cliInput: CrearClubInput = {
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
    if (rechazo.ok) return;
    assert.equal(rechazo.status, 409);
    assert.match(rechazo.error, new RegExp(MEMBRESIA_A));
  });

  const repoConMembresiaLibre: TenantsRepo = {
    ...tenantsRepoPrisma,
    async findOrganizationByMembresia() {
      return null;
    },
  };
  const depsConMembresiaLibre: TenantsDeps = {
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

    const categoriasCount = await runAsPlatform(() =>
      prisma.categoriaEvento.count({ where: { organizationId: cliOrganizationId } }),
    );
    assert.equal(categoriasCount, 6);

    const declaracionDb = await runAsPlatform(() =>
      prisma.declaracionJuradaVersion.findFirst({
        where: { organizationId: cliOrganizationId, vigenteHasta: null },
      }),
    );
    assert.ok(declaracionDb);
    const items = declaracionDb?.items as unknown as string[];
    assert.equal(declaracionDb?.hashSha256, computeDeclaracionHash(declaracionDb?.titulo ?? '', items));
  });

  let cliAdminToken = '';
  let cliEventoId = '';

  await check(
    'el club creado por el CLI queda operativo de punta a punta: acepta la invitación, inicia sesión, ve sus 6 categorías y publica un evento con declaración vigente',
    async () => {
      const aceptar = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', {
        token: primerTokenAdmin,
        name: 'Admin Club CLI',
        password: CLI_PASSWORD,
      });
      assert.equal(aceptar.status, 201);

      const login = await postJson(baseUrl, '/api/auth/login', { email: cliAdminEmail, password: CLI_PASSWORD });
      assert.equal(login.status, 200);
      cliAdminToken = (login.body as { token: string }).token;

      const categorias = await getJson(baseUrl, cliAdminToken, '/api/eventos/categorias');
      assert.equal(categorias.status, 200);
      const listaCategorias = categorias.body as { id: number; slug: string }[];
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
      cliEventoId = (crearEvento.body as { id: string }).id;

      const publicar = await postJsonAuth(baseUrl, cliAdminToken, `/api/eventos/${cliEventoId}/publicar`, {});
      assert.equal(publicar.status, 200);

      const detalle = await getJson(baseUrl, cliAdminToken, `/api/eventos/${cliEventoId}`);
      assert.equal(detalle.status, 200);
      const detalleBody = detalle.body as { estado: string; declaracionVigente: { version: string } | null };
      assert.equal(detalleBody.estado, 'PUBLICADO');
      assert.equal(detalleBody.declaracionVigente?.version, '2026-08');
    },
  );

  await check(
    'POST /api/auth/login devuelve la organización pública propia del club recién creado (7 campos, sin datos privados) y clubes con su única membresía',
    async () => {
      const login = await postJson(baseUrl, '/api/auth/login', { email: cliAdminEmail, password: CLI_PASSWORD });
      assert.equal(login.status, 200);
      const body = login.body as {
        user: { organization?: Record<string, unknown>; clubes?: { slug: string; rol: string }[] };
      };
      const org = body.user.organization;
      assert.ok(org);
      assert.deepEqual(Object.keys(org!).sort(), [
        'hasLogo', 'id', 'logoVersion', 'membresiaPropia', 'name', 'shortName', 'slug',
      ]);
      assert.equal(org!.hasLogo, false);
      assert.equal(org!.logoVersion, null);
      assert.equal(org!.slug, cliSlug);
      assert.equal(org!.membresiaPropia, MEMBRESIA_A);

      assert.equal(body.user.clubes?.length, 1);
      assert.equal(body.user.clubes?.[0]?.slug, cliSlug);
      assert.equal(body.user.clubes?.[0]?.rol, 'ADMIN');
    },
  );

  await check('invita a un SOCIO del club nuevo (invitación normal, no de plataforma)', async () => {
    const invitar = await postJsonAuth(baseUrl, cliAdminToken, '/api/invitaciones', {
      email: cliSocioEmail,
      rol: 'SOCIO',
    });
    assert.equal(invitar.status, 201);
  });

  await check(
    'ni el club A ni el club B ven el evento del club nuevo, y el admin del club nuevo no ve la salida del club A',
    async () => {
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
    },
  );

  await check('suspende el club nuevo: el token del admin recibe 403 y el login queda rechazado', async () => {
    const suspender = await runAsPlatform(() => cambiarEstadoClub(depsOperativos, cliSlug, 'SUSPENDED'));
    assert.equal(suspender.ok, true);
    if (!suspender.ok) return;
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
    if (!activar.ok) return;
    assert.equal(activar.body.estadoAnterior, 'SUSPENDED');
    assert.equal(activar.body.estadoNuevo, 'ACTIVE');
    assert.equal(activar.body.sinCambios, false);

    const resReactivado = await getJson(baseUrl, cliAdminToken, '/api/eventos/categorias');
    assert.equal(resReactivado.status, 200);

    const activarDeNuevo = await runAsPlatform(() => cambiarEstadoClub(depsOperativos, cliSlug, 'ACTIVE'));
    assert.equal(activarDeNuevo.ok, true);
    if (!activarDeNuevo.ok) return;
    assert.equal(activarDeNuevo.body.sinCambios, true);
  });

  await check(
    'invitarAdminClub reemite el link: el primer token deja de servir y el segundo queda vigente',
    async () => {
      const primera = await runAsPlatform(() => invitarAdminClub(depsOperativos, cliSlug, cliReinviteEmail));
      assert.equal(primera.ok, true);
      if (!primera.ok) return;
      const primerToken = primera.body.inviteUrl.split('#invite=')[1] ?? '';

      const segunda = await runAsPlatform(() => invitarAdminClub(depsOperativos, cliSlug, cliReinviteEmail));
      assert.equal(segunda.ok, true);
      if (!segunda.ok) return;
      const segundoToken = segunda.body.inviteUrl.split('#invite=')[1] ?? '';

      const consultaPrimero = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token: primerToken });
      assert.equal(consultaPrimero.status, 410);

      const consultaSegundo = await postJson(baseUrl, '/api/auth/invitaciones/consultar', { token: segundoToken });
      assert.equal(consultaSegundo.status, 200);
    },
  );

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

// ─── Cambio de rol y Membresia ──────────────────────────────────────────────

async function runRoleChangeMembresiaChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });

  await check(
    'PATCH /api/admin/users/:id/rol actualiza también la Membresia del usuario (mismo club, mismo rol nuevo)',
    async () => {
      const res = await patchJsonAuth(baseUrl, tokenA, `/api/admin/users/${seedA.socioUserId}/rol`, { rol: 'LIDER' });
      assert.equal(res.status, 200);
      const body = res.body as { rol: string };
      assert.equal(body.rol, 'LIDER');

      const membresia = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: seedA.socioUserId } },
        }),
      );
      assert.ok(membresia);
      assert.equal(membresia?.rol, 'LIDER');
    },
  );

  await check(
    'PATCH /api/admin/users/:id/rol — el admin de A no puede cambiar el rol de alguien que solo es socio de B (404, User ya es global) (Review Focus #2)',
    async () => {
      const res = await patchJsonAuth(baseUrl, tokenA, `/api/admin/users/${seedB.socioUserId}/rol`, { rol: 'ADMIN' });
      assert.equal(res.status, 404);

      const membresiaIntacta = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedB.organizationId, usuarioId: seedB.socioUserId } },
        }),
      );
      assert.equal(membresiaIntacta?.rol, 'SOCIO');
    },
  );
}

// ─── Resolución de club activo (X-Club) y membresías múltiples ────────────────

async function runAuthMembershipChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  // El socio de A también se hace ADMIN de B — la única cuenta de todo el
  // fixture con más de una membresía, y con un rol DISTINTO en cada club, así
  // los checks de abajo prueban que el rol activo es el de la MEMBRESÍA, no
  // el de User.rol "primario". Nunca se limpia a mano: la purga final de B
  // borra esta fila junto con el resto de sus membresías.
  const tokenMulti = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
  await runAsPlatform(() =>
    prisma.membresia.create({
      data: { organizationId: seedB.organizationId, usuarioId: seedA.socioUserId, rol: 'ADMIN' },
    }),
  );

  await check('GET /api/me con X-Club resuelve la membresía de ESE club (rol incluido)', async () => {
    const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_A);
    assert.equal(res.status, 200);
    const body = res.body as { user: { rol: string; organization: { slug: string } } };
    assert.equal(body.user.organization.slug, SLUG_A);
    // LIDER y no SOCIO: runRoleChangeMembresiaChecks ya promovió a este mismo
    // socio a LIDER en A (su club primario) antes de este punto de la suite,
    // lo que también actualizó su User.rol heredado por la misma razón. La
    // prueba de que el rol viene de la MEMBRESÍA activa (y no ciegamente de
    // User.rol) la da el siguiente check, con la membresía recién creada en
    // B (ADMIN, distinta del rol primario).
    assert.equal(body.user.rol, 'LIDER');
  });

  await check('GET /api/me con X-Club de la OTRA membresía resuelve SU rol ahí (ADMIN, no SOCIO)', async () => {
    const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_B);
    assert.equal(res.status, 200);
    const body = res.body as { user: { rol: string; organization: { slug: string } } };
    assert.equal(body.user.organization.slug, SLUG_B);
    assert.equal(body.user.rol, 'ADMIN');
  });

  await check('GET /api/me sin X-Club y con varias membresías responde 400 "Selecciona un club"', async () => {
    const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', undefined);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Selecciona un club' });
  });

  await check('GET /api/me con X-Club de un club inexistente responde 404 "Club no encontrado"', async () => {
    const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', `iso-test-no-existe-${RANDOM_SUFFIX}`);
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Club no encontrado' });
  });

  await check(
    'GET /api/me con X-Club de un club real del que NO es socio responde 403 "No perteneces a este club"',
    async () => {
      const tokenSoloA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
      const res = await getJsonWithClub(baseUrl, tokenSoloA, '/api/me', SLUG_B);
      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: 'No perteneces a este club' });
    },
  );

  await check(
    'GET /api/me con X-Club de un club suspendido responde 403 con el mensaje de club suspendido',
    async () => {
      await runAsPlatform(() =>
        prisma.organization.update({ where: { id: seedA.organizationId }, data: { status: 'SUSPENDED' } }),
      );
      try {
        const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_A);
        assert.equal(res.status, 403);
        const body = res.body as { error: string };
        assert.match(body.error, /suspendido/i);
      } finally {
        await runAsPlatform(() =>
          prisma.organization.update({ where: { id: seedA.organizationId }, data: { status: 'ACTIVE' } }),
        );
      }
    },
  );

  await check(
    'PATCH /api/admin/users/:id/rol en B no toca la columna heredada User.rol/organizationId cuando B no es el club primario (Review Focus #3)',
    async () => {
      const tokenB = signToken({ userId: seedB.adminUserId, email: seedB.adminEmail });
      const antes = await runAsPlatform(() => prisma.user.findUnique({ where: { id: seedA.socioUserId } }));

      try {
        const res = await patchJsonAuth(baseUrl, tokenB, `/api/admin/users/${seedA.socioUserId}/rol`, { rol: 'LIDER' });
        assert.equal(res.status, 200);
        assert.equal((res.body as { rol: string }).rol, 'LIDER');

        const despues = await runAsPlatform(() => prisma.user.findUnique({ where: { id: seedA.socioUserId } }));
        // User.organizationId/rol (columna heredada) sigue intacta: A sigue
        // siendo el club "primario" de la cuenta, y este cambio ocurrió en B.
        assert.equal(despues?.organizationId, seedA.organizationId);
        assert.equal(despues?.rol, antes?.rol);
      } finally {
        // Deja la membresía de B como la espera runClubesFieldChecks (Task
        // 3): ADMIN, tal como la creó este mismo fixture.
        await runAsPlatform(() =>
          prisma.membresia.update({
            where: { organizationId_usuarioId: { organizationId: seedB.organizationId, usuarioId: seedA.socioUserId } },
            data: { rol: 'ADMIN' },
          }),
        );
      }
    },
  );
}

// ─── Campo clubes en /me (login ya se cubre arriba, en runTenantCliChecks) ────

async function runClubesFieldChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  // Reutiliza el fixture de runAuthMembershipChecks (socio de A, también
  // ADMIN de B) — ya existe para cuando esta función corre.
  const tokenMulti = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });

  await check(
    'GET /api/me devuelve clubes con TODAS las membresías de la cuenta (slug/name/shortName/hasLogo/logoVersion/rol), no solo la activa',
    async () => {
      const res = await getJsonWithClub(baseUrl, tokenMulti, '/api/me', SLUG_A);
      assert.equal(res.status, 200);
      const body = res.body as {
        user: {
          clubes?: { slug: string; name: string; shortName: string | null; hasLogo: boolean; logoVersion: string | null; rol: string }[];
        };
      };
      const clubes = body.user.clubes;
      assert.ok(clubes);
      assert.equal(clubes!.length, 2);
      assert.deepEqual(Object.keys(clubes![0]!).sort(), ['hasLogo', 'logoVersion', 'name', 'rol', 'shortName', 'slug']);
      const porSlug = Object.fromEntries(clubes!.map((c) => [c.slug, c]));
      // LIDER y no SOCIO: runRoleChangeMembresiaChecks ya promovió a este
      // mismo socio a LIDER en A antes de este punto de la suite (ver el
      // comentario equivalente en runAuthMembershipChecks, más arriba).
      assert.equal(porSlug[SLUG_A]?.rol, 'LIDER');
      assert.equal(porSlug[SLUG_B]?.rol, 'ADMIN');
    },
  );

  await check(
    'POST /api/auth/forgot-password con X-Club de un club ajeno no revienta y responde el mensaje genérico igual',
    async () => {
      const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Club': SLUG_B },
        body: JSON.stringify({ email: seedA.adminEmail }),
      });
      const body = await res.json().catch(() => undefined);
      assert.equal(res.status, 200);
      assert.deepEqual(body, {
        message: 'Si el email está registrado, recibirás un enlace para restablecer tu contraseña.',
      });
    },
  );

  // El check HTTP de arriba solo pin-ea la respuesta (invariante a propósito:
  // no revela si el email existe), así que NO puede detectar una regresión en
  // el cableado interno — por ejemplo, que forgotPassword empiece a usar el
  // club del header directamente sin comprobar la membresía. Estos checks
  // llaman a resolveResetBrandingOrganizationIdForEmail (la función que
  // forgotPassword ya usa) directamente, en contexto de plataforma, y
  // verifican el organizationId que devuelve.
  await check(
    'resolveResetBrandingOrganizationIdForEmail: X-Club de una membresía propia de la cuenta devuelve ESE club',
    async () => {
      const orgId = await runAsPlatform(() => resolveResetBrandingOrganizationIdForEmail(seedA.socioEmail, SLUG_B));
      assert.equal(orgId, seedB.organizationId);
    },
  );

  await check(
    'resolveResetBrandingOrganizationIdForEmail: X-Club de un club del que la cuenta NO es socia cae a su membresía más antigua, no al club del header',
    async () => {
      const orgId = await runAsPlatform(() => resolveResetBrandingOrganizationIdForEmail(seedA.adminEmail, SLUG_B));
      assert.equal(orgId, seedA.organizationId);
    },
  );

  await check('resolveResetBrandingOrganizationIdForEmail: sin X-Club cae a la membresía más antigua', async () => {
    const orgId = await runAsPlatform(() => resolveResetBrandingOrganizationIdForEmail(seedA.adminEmail, undefined));
    assert.equal(orgId, seedA.organizationId);
  });

  await check(
    'resolveResetBrandingOrganizationIdForEmail: X-Club con un slug inexistente cae a la membresía más antigua',
    async () => {
      const orgId = await runAsPlatform(() =>
        resolveResetBrandingOrganizationIdForEmail(seedA.adminEmail, `iso-test-no-existe-${RANDOM_SUFFIX}`),
      );
      assert.equal(orgId, seedA.organizationId);
    },
  );

  await check('resolveResetBrandingOrganizationIdForEmail: un email inexistente devuelve null', async () => {
    const orgId = await runAsPlatform(() =>
      resolveResetBrandingOrganizationIdForEmail(`no-existe-${RANDOM_SUFFIX}@iso-test.local`, undefined),
    );
    assert.equal(orgId, null);
  });
}

// ─── Invitar/reenviar/QR-por-correo con una cuenta existente (PR "Joining") ────

async function runInviteJoiningChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenAdminA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });

  await check(
    'POST /api/invitaciones con el email de una cuenta que ya existe SOLO EN B: A la invita igual (201), no 409',
    async () => {
      const res = await postJsonAuth(baseUrl, tokenAdminA, '/api/invitaciones', { email: seedB.adminEmail });
      assert.equal(res.status, 201);
    },
  );

  await check(
    'POST /api/invitaciones con el email de alguien que YA es socio de A responde 409 "Ya es socio de este club"',
    async () => {
      const res = await postJsonAuth(baseUrl, tokenAdminA, '/api/invitaciones', { email: seedA.socioEmail });
      assert.equal(res.status, 409);
      assert.deepEqual(res.body, { error: 'Ya es socio de este club' });
    },
  );
}

// ─── aceptarInvitacion con una cuenta existente (PR "Joining") ────────────────

async function runAcceptJoiningChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenAdminA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });
  const B_PASSWORD = 'password-b-existente';

  // Una cuenta nueva, propia de B, con contraseña conocida — para poder
  // probarla como "cuenta existente" al unirse a A.
  const emailExistenteEnB = `joining-existente-${RANDOM_SUFFIX}@iso-test.local`;
  const usuarioExistenteEnB = await runAsPlatform(async () => {
    const passwordHash = await bcrypt.hash(B_PASSWORD, SALT_ROUNDS);
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { organizationId: seedB.organizationId, email: emailExistenteEnB, name: 'Existente En B', passwordHash, rol: 'SOCIO', emailVerified: true },
      });
      await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
      return user;
    });
  });

  async function invitarYObtenerToken(email: string, rol: 'SOCIO' | 'LIDER' | 'ADMIN' = 'LIDER'): Promise<string> {
    const invitar = await postJsonAuth(baseUrl, tokenAdminA, '/api/invitaciones', { email, rol });
    assert.equal(invitar.status, 201);
    const inviteUrl = (invitar.body as { inviteUrl: string }).inviteUrl;
    return new URL(inviteUrl).hash.replace('#invite=', '');
  }

  await check('aceptar con la contraseña correcta de la cuenta existente crea SOLO la Membresia en A, con el rol de la invitación', async () => {
    const token = await invitarYObtenerToken(emailExistenteEnB, 'LIDER');
    const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', { token, name: 'Nombre Que Se Ignora', password: B_PASSWORD });
    assert.equal(res.status, 201);

    const membresiaA = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: usuarioExistenteEnB.id } },
      }),
    );
    assert.ok(membresiaA);
    assert.equal(membresiaA?.rol, 'LIDER');

    // El perfil compartido nunca se tocó: sigue el nombre original de B, no
    // "Nombre Que Se Ignora".
    const perfil = await runAsPlatform(() => prisma.user.findUnique({ where: { id: usuarioExistenteEnB.id } }));
    assert.equal(perfil?.name, 'Existente En B');
  });

  await check(
    'aceptar con rol/organizationId/email en conflicto en el body: la Membresia real en la DB usa el rol y el club de la INVITACIÓN, nunca los del body',
    async () => {
      const emailConflicto = `joining-conflicto-${RANDOM_SUFFIX}@iso-test.local`;
      const passwordConflicto = 'password-conflicto-existente';
      const passwordHash = await bcrypt.hash(passwordConflicto, SALT_ROUNDS);
      const cuenta = await runAsPlatform(async () =>
        prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { organizationId: seedB.organizationId, email: emailConflicto, name: 'Nombre Original Conflicto', passwordHash, rol: 'SOCIO', emailVerified: true },
          });
          await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
          return user;
        }),
      );
      // La invitación otorga LIDER en A — el body de abajo intenta colarse
      // con otro rol, otro club y hasta otro email.
      const token = await invitarYObtenerToken(emailConflicto, 'LIDER');
      const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', {
        token,
        name: 'Nombre Que Se Ignora',
        password: passwordConflicto,
        rol: 'ADMIN',
        organizationId: seedB.organizationId,
        email: seedA.adminEmail,
      });
      assert.equal(res.status, 201);

      // La Membresia real en A quedó con el rol de la INVITACIÓN (LIDER),
      // nunca con el 'ADMIN' del body.
      const membresiaA = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: cuenta.id } },
        }),
      );
      assert.ok(membresiaA);
      assert.equal(membresiaA?.rol, 'LIDER');

      // No se creó ninguna Membresia extra bajo el organizationId inyectado
      // en el body (que además coincide con el club real de B: si el bug
      // existiera, esto seguiría siendo una fila más allá de la ya sembrada
      // arriba para 'cuenta').
      const membresiasDeLaCuenta = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: cuenta.id } }));
      assert.equal(membresiasDeLaCuenta.length, 2); // la sembrada en B + la nueva en A.

      // El perfil compartido nunca se tocó: sigue el nombre/email original.
      const perfil = await runAsPlatform(() => prisma.user.findUnique({ where: { id: cuenta.id } }));
      assert.equal(perfil?.name, 'Nombre Original Conflicto');
      assert.equal(perfil?.email, emailConflicto);
    },
  );

  await check('aceptar con la contraseña incorrecta responde 401 y no crea ninguna Membresia', async () => {
    const emailOtra = `joining-mal-password-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('la-correcta', SALT_ROUNDS);
    const cuenta = await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailOtra, name: 'Mal Password', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
        return user;
      }),
    );
    const token = await invitarYObtenerToken(emailOtra);
    const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', { token, name: 'X', password: 'la-incorrecta' });
    assert.equal(res.status, 401);

    const membresiaA = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: cuenta.id } },
      }),
    );
    assert.equal(membresiaA, null);
  });

  await check('varios intentos de contraseña incorrecta contra el MISMO token siguen fallando 401, nunca 200 (Review Focus #1 — la política de brute force sigue siendo la del rate limiter existente)', async () => {
    const emailBrute = `joining-brute-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('la-real', SALT_ROUNDS);
    await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailBrute, name: 'Brute', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
      }),
    );
    const token = await invitarYObtenerToken(emailBrute);
    // Cada intento debe pasar la validación de forma (mínimo 8 caracteres)
    // para llegar de verdad a la comparación de contraseña — un intento de
    // 1 carácter daría 400 (Zod) antes de tocar comparePassword, sin probar
    // nada sobre el límite de intentos.
    for (const intento of ['incorrecta-1', 'incorrecta-2', 'incorrecta-3']) {
      const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', { token, name: 'X', password: intento });
      assert.equal(res.status, 401);
    }
  });

  await check('aceptar con un Bearer del MISMO email crea la Membresia sin enviar contraseña', async () => {
    const emailBearer = `joining-bearer-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('no-se-usa', SALT_ROUNDS);
    const cuenta = await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailBearer, name: 'Bearer', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
        return user;
      }),
    );
    const token = await invitarYObtenerToken(emailBearer);
    const bearerCuenta = signToken({ userId: cuenta.id, email: emailBearer });
    const res = await postJsonAuth(baseUrl, bearerCuenta, '/api/auth/invitaciones/aceptar', { token });
    assert.equal(res.status, 201);

    const membresiaA = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: cuenta.id } },
      }),
    );
    assert.ok(membresiaA);
  });

  await check('aceptar con un Bearer de OTRO email responde 403 "Esta invitación es para otro correo" (Review Focus #4)', async () => {
    const emailMismatch = `joining-mismatch-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('x', SALT_ROUNDS);
    await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailMismatch, name: 'Mismatch', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
      }),
    );
    const token = await invitarYObtenerToken(emailMismatch);
    // seedA.socioUserId es una cuenta real, pero NO la invitada.
    const bearerAjeno = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
    const res = await postJsonAuth(baseUrl, bearerAjeno, '/api/auth/invitaciones/aceptar', { token });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'Esta invitación es para otro correo' });
  });

  await check('dos aceptaciones concurrentes de la MISMA invitación (cuenta existente) crean exactamente una Membresia (Review Focus #3)', async () => {
    const emailRace = `joining-race-${RANDOM_SUFFIX}@iso-test.local`;
    const passwordHash = await bcrypt.hash('race-password', SALT_ROUNDS);
    const cuenta = await runAsPlatform(async () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email: emailRace, name: 'Race', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
        return user;
      }),
    );
    const token = await invitarYObtenerToken(emailRace);
    const [primero, segundo] = await Promise.all([
      postJson(baseUrl, '/api/auth/invitaciones/aceptar', { token, name: 'X', password: 'race-password' }),
      postJson(baseUrl, '/api/auth/invitaciones/aceptar', { token, name: 'X', password: 'race-password' }),
    ]);
    const statuses = [primero.status, segundo.status].sort();
    // Exactamente uno gana (201); el otro pierde la carrera del update
    // condicional (409, MENSAJE_NO_PENDIENTE).
    assert.deepEqual(statuses, [201, 409]);

    const membresias = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: cuenta.id } }));
    assert.equal(membresias.length, 2); // la de B (seed) + la nueva de A.
  });

  await check('sin cuenta existente, aceptar sigue creando la cuenta nueva (regresión)', async () => {
    const emailNuevo = `joining-nuevo-${RANDOM_SUFFIX}@iso-test.local`;
    const token = await invitarYObtenerToken(emailNuevo, 'SOCIO');
    const res = await postJson(baseUrl, '/api/auth/invitaciones/aceptar', { token, name: 'Persona Nueva', password: 'password123' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { message: 'Cuenta creada. Ya puedes iniciar sesión.', email: emailNuevo });
  });
}

// ─── registrarConQrDirecto con una cuenta existente (PR "Joining") ────────────

async function runQrDirectoJoiningChecks(baseUrl: string, seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  const tokenAdminA = signToken({ userId: seedA.adminUserId, email: seedA.adminEmail });

  async function crearQrDirectoYObtenerToken(): Promise<{ id: string; token: string }> {
    const res = await postJsonAuth(baseUrl, tokenAdminA, '/api/invitaciones/qr', { modo: 'DIRECTO' });
    assert.equal(res.status, 201);
    const body = res.body as { codigo: { id: string }; qrUrl: string };
    return { id: body.codigo.id, token: new URL(body.qrUrl).hash.replace('#qr=', '') };
  }

  async function crearCuentaEnB(email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    return runAsPlatform(() =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { organizationId: seedB.organizationId, email, name: 'Existente QR', passwordHash, rol: 'SOCIO', emailVerified: true },
        });
        await tx.membresia.create({ data: { organizationId: seedB.organizationId, usuarioId: user.id, rol: 'SOCIO' } });
        return user;
      }),
    );
  }

  await check('QR directo con la contraseña correcta de una cuenta existente crea SOLO la Membresia en A y consume el único uso', async () => {
    const email = `qr-directo-existe-${RANDOM_SUFFIX}@iso-test.local`;
    const cuenta = await crearCuentaEnB(email, 'qr-directo-password');
    const { token } = await crearQrDirectoYObtenerToken();

    const res = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'Se Ignora', email, password: 'qr-directo-password' });
    assert.equal(res.status, 201);

    const membresiaA = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: cuenta.id } },
      }),
    );
    assert.ok(membresiaA);

    // El perfil compartido nunca se tocó: sigue el nombre/hash/verificación
    // originales de B, no "Se Ignora", y la columna heredada (club/rol
    // primario) sigue apuntando a B — misma comprobación que Task 3
    // (aceptarInvitacion) sobre la cuenta existente.
    const perfil = await runAsPlatform(() => prisma.user.findUnique({ where: { id: cuenta.id } }));
    assert.equal(perfil?.name, cuenta.name);
    assert.equal(perfil?.passwordHash, cuenta.passwordHash);
    assert.equal(perfil?.emailVerified, cuenta.emailVerified);
    assert.equal(perfil?.organizationId, cuenta.organizationId);
    assert.equal(perfil?.rol, cuenta.rol);

    // Un segundo intento contra el MISMO código (ya de un solo uso) da 410,
    // aunque la contraseña sea correcta — el uso ya se consumió.
    const segundo = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'qr-directo-password' });
    assert.equal(segundo.status, 410);
  });

  await check('QR directo con la contraseña incorrecta responde 401 y NO consume el uso', async () => {
    const email = `qr-directo-mal-${RANDOM_SUFFIX}@iso-test.local`;
    await crearCuentaEnB(email, 'la-correcta');
    const { token } = await crearQrDirectoYObtenerToken();

    const res = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'la-incorrecta' });
    assert.equal(res.status, 401);

    // El uso sigue disponible: un segundo intento con la contraseña correcta
    // funciona.
    const segundo = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'la-correcta' });
    assert.equal(segundo.status, 201);
  });

  await check(
    'varios intentos de contraseña incorrecta contra el MISMO código directo siguen fallando 401, nunca consumen el uso (Review Focus #1 — la política de brute force sigue siendo la del rate limiter existente)',
    async () => {
      const email = `qr-directo-brute-${RANDOM_SUFFIX}@iso-test.local`;
      await crearCuentaEnB(email, 'la-real-brute');
      const { id, token } = await crearQrDirectoYObtenerToken();

      const codigoAntes = await runAsPlatform(() => prisma.codigoQrInvitacion.findUnique({ where: { id } }));
      assert.equal(codigoAntes?.usosRestantes, 1);

      // Cada intento debe pasar la validación de forma (mínimo 8 caracteres)
      // para llegar de verdad a la comparación de contraseña — un intento de
      // 1 carácter daría 400 (Zod) antes de tocar comparePassword, sin probar
      // nada sobre el límite de intentos.
      for (const intento of ['incorrecta-1', 'incorrecta-2', 'incorrecta-3']) {
        const res = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: intento });
        assert.equal(res.status, 401);
      }

      const codigoDespues = await runAsPlatform(() => prisma.codigoQrInvitacion.findUnique({ where: { id } }));
      assert.equal(codigoDespues?.usosRestantes, codigoAntes?.usosRestantes);
      assert.equal(codigoDespues?.registradoUsuarioId, null);

      const membresiaA = await runAsPlatform(() =>
        prisma.membresia.findFirst({ where: { organizationId: seedA.organizationId, usuario: { email } } }),
      );
      assert.equal(membresiaA, null);
    },
  );

  await check('QR directo con un Bearer de OTRO email responde 403 "Este código es para otro correo"', async () => {
    const email = `qr-directo-mismatch-${RANDOM_SUFFIX}@iso-test.local`;
    await crearCuentaEnB(email, 'x');
    const { token } = await crearQrDirectoYObtenerToken();

    const bearerAjeno = signToken({ userId: seedA.socioUserId, email: seedA.socioEmail });
    const res = await postJsonAuth(baseUrl, bearerAjeno, '/api/qr/registrar', { token, email });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'Este código es para otro correo' });
  });

  await check('dos registros concurrentes con la MISMA cuenta existente y el MISMO código directo consumen el uso exactamente una vez', async () => {
    const email = `qr-directo-race-${RANDOM_SUFFIX}@iso-test.local`;
    const cuenta = await crearCuentaEnB(email, 'race-password');
    const { token } = await crearQrDirectoYObtenerToken();

    const [primero, segundo] = await Promise.all([
      postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'race-password' }),
      postJson(baseUrl, '/api/qr/registrar', { token, name: 'X', email, password: 'race-password' }),
    ]);
    const statuses = [primero.status, segundo.status].sort();
    assert.deepEqual(statuses, [201, 410]);

    const membresias = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: cuenta.id } }));
    assert.equal(membresias.length, 2); // la de B (seed) + la nueva de A.
  });

  await check('QR directo sin cuenta existente sigue creando la cuenta nueva (regresión)', async () => {
    // Email distinto del que usa runQrDirectoChecks más arriba
    // ('qr-directo-nuevo-...'): ese ya deja una cuenta creada en A antes de
    // que este check corra, así que reusar el mismo literal entraría por la
    // rama de cuenta existente en vez de probar el camino sin cuenta.
    const email = `qr-directo-nuevo-joining-${RANDOM_SUFFIX}@iso-test.local`;
    const { token } = await crearQrDirectoYObtenerToken();
    const res = await postJson(baseUrl, '/api/qr/registrar', { token, name: 'Persona Nueva', email, password: 'password123' });
    assert.equal(res.status, 201);
  });
}

// ─── CLI create-user ─────────────────────────────────────────────────────────

interface CreateUserCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Corre create-user.ts como proceso real (misma DATABASE_URL, guardada por
// su propio db:guard). stdin no es una TTY en un proceso hijo con stdio en
// pipe, así que readPassword() toma la rama de una sola línea (ver
// create-user.ts, readLineFromStdin): ni confirmación ni eco oculto, una
// línea con la contraseña basta.
function runCreateUserCli(args: string[], password: string): Promise<CreateUserCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/scripts/create-user.ts', ...args], {
      cwd: process.cwd(),
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(`${password}\n`);
    child.stdin.end();
  });
}

async function runCreateUserCliChecks(seedA: OrgSeed, seedB: OrgSeed): Promise<void> {
  await check('CLI create-user: un usuario nuevo obtiene exactamente una Membresia con su rol y club', async () => {
    const email = `cli-nuevo-${RANDOM_SUFFIX}@iso-test.local`;
    const result = await runCreateUserCli(
      ['--email', email, '--name', 'CLI Nuevo', '--org', SLUG_A, '--rol', 'LIDER'],
      'password123',
    );
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const user = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
    assert.ok(user);
    const membresias = await runAsPlatform(() => prisma.membresia.findMany({ where: { usuarioId: user!.id } }));
    assert.equal(membresias.length, 1);
    assert.equal(membresias[0]?.organizationId, seedA.organizationId);
    assert.equal(membresias[0]?.rol, 'LIDER');
  });

  await check('CLI create-user --force: cambia el rol y también actualiza la Membresia existente', async () => {
    const email = `cli-force-${RANDOM_SUFFIX}@iso-test.local`;
    const primero = await runCreateUserCli(
      ['--email', email, '--name', 'CLI Force', '--org', SLUG_A, '--rol', 'SOCIO'],
      'password123',
    );
    assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

    const segundo = await runCreateUserCli(
      ['--email', email, '--name', 'CLI Force', '--org', SLUG_A, '--rol', 'ADMIN', '--force'],
      'password123',
    );
    assert.equal(segundo.code, 0, `stderr: ${segundo.stderr}`);

    const user = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
    assert.ok(user);
    const membresia = await runAsPlatform(() =>
      prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: user!.id } },
      }),
    );
    assert.ok(membresia);
    assert.equal(membresia?.rol, 'ADMIN');
  });

  await check(
    'CLI create-user --force autosana una Membresia faltante (fila borrada a mano) en vez de fallar (Review Focus #5)',
    async () => {
      const email = `cli-force-autosana-${RANDOM_SUFFIX}@iso-test.local`;
      const primero = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Autosana', '--org', SLUG_A, '--rol', 'SOCIO'],
        'password123',
      );
      assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

      const user = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      assert.ok(user);
      await runAsPlatform(() =>
        prisma.membresia.delete({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: user!.id } },
        }),
      );

      const segundo = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Autosana', '--org', SLUG_A, '--rol', 'LIDER', '--force'],
        'password123',
      );
      assert.equal(segundo.code, 0, `stderr: ${segundo.stderr}`);

      const membresia = await runAsPlatform(() =>
        prisma.membresia.findUnique({
          where: { organizationId_usuarioId: { organizationId: seedA.organizationId, usuarioId: user!.id } },
        }),
      );
      assert.ok(membresia);
      assert.equal(membresia?.rol, 'LIDER');
    },
  );

  await check(
    'CLI create-user sin --force sigue rechazando cuando la cuenta YA es socia de este club',
    async () => {
      const email = `cli-rechazo-${RANDOM_SUFFIX}@iso-test.local`;
      const primero = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Rechazo', '--org', SLUG_A, '--rol', 'SOCIO'],
        'password123',
      );
      assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

      const segundo = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Rechazo', '--org', SLUG_A, '--rol', 'LIDER'],
        'password123',
      );
      assert.notEqual(segundo.code, 0);
      assert.match(segundo.stderr, /ya es socio de/);
    },
  );

  await check(
    'CLI create-user: cuenta existente en OTRO club recibe la membresía nueva en vez de ser rechazada (Ruling 2 del plan de esta PR)',
    async () => {
      const email = `cli-multi-${RANDOM_SUFFIX}@iso-test.local`;
      const primero = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Multi Original', '--org', SLUG_B, '--rol', 'SOCIO'],
        'password123',
      );
      assert.equal(primero.code, 0, `stderr: ${primero.stderr}`);

      const segundo = await runCreateUserCli(
        ['--email', email, '--name', 'CLI Multi Ignorado', '--org', SLUG_A, '--rol', 'LIDER'],
        'password123',
      );
      // Éxito, no rechazo: antes de este PR, un email existente en otro club
      // siempre fallaba (incluso con --force).
      assert.equal(segundo.code, 0, `stderr: ${segundo.stderr}`);
      assert.doesNotMatch(segundo.stdout + segundo.stderr, /pertenece a otra organización/);

      const user = await runAsPlatform(() => prisma.user.findUnique({ where: { email } }));
      assert.ok(user);
      // El alta aditiva nunca toca el perfil compartido: el nombre sigue
      // siendo el original, pese a que el segundo comando pasó otro con
      // --name (Review Focus #4).
      assert.equal(user!.name, 'CLI Multi Original');

      const membresias = await runAsPlatform(() =>
        prisma.membresia.findMany({ where: { usuarioId: user!.id }, orderBy: { creadoAt: 'asc' } }),
      );
      assert.equal(membresias.length, 2);
      assert.equal(membresias[0]?.organizationId, seedB.organizationId);
      assert.equal(membresias[0]?.rol, 'SOCIO');
      assert.equal(membresias[1]?.organizationId, seedA.organizationId);
      assert.equal(membresias[1]?.rol, 'LIDER');
    },
  );
}

// ─── Orquestación ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Guardia real (no solo el pre-hook npm db:guard): correr este archivo
  // directamente con node/tsx ya no puede saltarse la verificación de destino.
  verifyDbTargetOrExit({
    prefix: '[test-isolation]',
    onMissingTarget: () =>
      console.log('[test-isolation] DATABASE_URL no está definido o no se pudo interpretar como una URL válida.'),
    failureMessage:
      '[test-isolation] Comando abortado: DATABASE_URL no coincide con la base de datos de v2 declarada en ' +
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

  let server: Server | undefined;

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
    await runRoleChangeMembresiaChecks(started.baseUrl, seedA, seedB);
    await runCreateUserCliChecks(seedA, seedB);
    await runAuthMembershipChecks(started.baseUrl, seedA, seedB);
    await runClubesFieldChecks(started.baseUrl, seedA, seedB);
    await runInviteJoiningChecks(started.baseUrl, seedA, seedB);
    await runAcceptJoiningChecks(started.baseUrl, seedA, seedB);
    await runQrDirectoJoiningChecks(started.baseUrl, seedA, seedB);

    await check(
      'invariante global: todo usuario de la base tiene al menos una Membresia (ningún alta se saltó el dual write) (Review Focus #1)',
      async () => {
        const huerfanos = await runAsPlatform(() => prisma.user.count({ where: { membresias: { none: {} } } }));
        assert.equal(huerfanos, 0);
      },
    );
  } catch (err) {
    results.push({
      label: 'ejecución general del script (fuera de un check individual)',
      ok: false,
      detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  } finally {
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

main().catch((err: unknown) => {
  console.error('[test-isolation] Error fatal:', err);
  process.exitCode = 1;
});
