import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RolUsuario } from '../generated/prisma/client.js';
import {
  crearCodigoQr,
  listarCodigosQr,
  verCodigoQr,
  revocarCodigoQr,
  estadoCodigoQr,
  consultarCodigoQr,
  solicitarInvitacionQr,
  registrarConQrDirecto,
  MENSAJE_SOLICITUD_GENERICA,
  type CodigosQrDeps,
  type CodigosQrRepo,
  type CodigoQrRow,
  type OrganizacionPublicaConEstado,
  type SendCodigoQrInvitationEmailParams,
} from './codigos-qr.service.js';
import type { InvitacionRow, Requester } from './invitaciones.service.js';
import { cifrarTokenQr, QR_DIRECTO_TTL_MS } from '../lib/codigos-qr.js';

// ─── Fake repo (en memoria, sin Prisma) ────────────────────────────────────────

interface FakeUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  rol: RolUsuario;
  emailVerified: boolean;
}

function createFakeRepo(seedUsers: FakeUser[] = []): {
  repo: CodigosQrRepo;
  users: FakeUser[];
  codigos: CodigoQrRow[];
  invitaciones: InvitacionRow[];
} {
  const users = [...seedUsers];
  const codigos: CodigoQrRow[] = [];
  const invitaciones: InvitacionRow[] = [];
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${++seq}`;

  const repo: CodigosQrRepo = {
    async create(data) {
      const row: CodigoQrRow = {
        id: nextId('qr'),
        organizationId: data.organizationId,
        tokenHash: data.tokenHash,
        tokenCifrado: data.tokenCifrado,
        rol: 'SOCIO',
        etiqueta: data.etiqueta,
        maxUsos: data.maxUsos,
        usosRestantes: data.usosRestantes,
        expiresAt: data.expiresAt,
        revocadoAt: null,
        createdAt: new Date(),
        creadoPorId: data.creadoPorId,
        modo: data.modo,
        registradoUsuarioId: null,
      };
      codigos.push(row);
      return row;
    },
    async list({ creadoPorId }) {
      return codigos
        .filter((c) => creadoPorId === undefined || c.creadoPorId === creadoPorId)
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((c) => ({ ...c, creadoPorNombre: users.find((u) => u.id === c.creadoPorId)?.name ?? null }));
    },
    async findById(id) {
      return codigos.find((c) => c.id === id) ?? null;
    },
    async findByTokenHash(tokenHash) {
      return codigos.find((c) => c.tokenHash === tokenHash) ?? null;
    },
    async markRevoked(id, now) {
      const c = codigos.find((c) => c.id === id);
      if (c) c.revocadoAt = now;
    },
    async findUserById(id) {
      const u = users.find((x) => x.id === id);
      return u ? { id: u.id, name: u.name, rol: u.rol, email: u.email } : null;
    },
    async findAccountMembershipStatus(email, organizationId) {
      const u = users.find((x) => x.email === email);
      if (!u) return { cuentaExiste: false, esSocioDeEsteClub: false };
      // Misma simplificación deliberada que en invitaciones.service.test.ts:
      // el fake nunca modeló Membresia como tabla propia, así que "socia de
      // este club" es, para el fake, "su organizationId ES este club".
      return { cuentaExiste: true, esSocioDeEsteClub: u.organizationId === organizationId };
    },
    async findAccountForOwnershipProof(email) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id, email: u.email, passwordHash: `hashed:${u.email}-password` } : null;
    },
    async hasPendingInvitacion(email, now) {
      return invitaciones.some(
        (inv) => inv.email === email && !inv.aceptadaAt && !inv.revocadaAt && inv.expiresAt > now,
      );
    },
    async mintInvitacion({ codigoQrId, organizationId, email, rol, tokenHash, expiresAt, invitadoPorId, now }) {
      const codigo = codigos.find((c) => c.id === codigoQrId);
      if (!codigo || codigo.revocadoAt !== null || codigo.expiresAt <= now || codigo.usosRestantes <= 0) {
        return null;
      }
      codigo.usosRestantes -= 1;
      const row: InvitacionRow = {
        id: nextId('inv'),
        organizationId,
        email,
        rol,
        tokenHash,
        expiresAt,
        invitadoPorId,
        emitidaPorPlataforma: false,
        aceptadaAt: null,
        usuarioId: null,
        revocadaAt: null,
        createdAt: now,
      };
      invitaciones.push(row);
      return row;
    },
    async registrarUsuarioQrDirecto({ codigoQrId, organizationId, email, name, passwordHash, rol, now }) {
      void passwordHash; // el fake repo no modela el hash — solo el servicio le pasa uno.
      const codigo = codigos.find((c) => c.id === codigoQrId);
      if (
        !codigo ||
        codigo.modo !== 'DIRECTO' ||
        codigo.revocadoAt !== null ||
        codigo.expiresAt <= now ||
        codigo.usosRestantes <= 0
      ) {
        return { kind: 'agotado' };
      }
      // Misma carrera que la violación P2002 del repo real: otra request para
      // el MISMO email ya ganó, entre el chequeo previo del servicio y acá.
      if (users.some((u) => u.email === email)) {
        return { kind: 'email-en-uso' };
      }

      codigo.usosRestantes -= 1;
      const user: FakeUser = { id: nextId('user'), organizationId, email, name, rol, emailVerified: true };
      users.push(user);
      codigo.registradoUsuarioId = user.id;

      return { kind: 'ok', user: { id: user.id, email: user.email, name: user.name, rol: user.rol } };
    },
    async registrarMembresiaQrDirectoExistente({ codigoQrId, organizationId, usuarioId, rol, now }) {
      const codigo = codigos.find((c) => c.id === codigoQrId);
      if (!codigo || codigo.modo !== 'DIRECTO' || codigo.revocadoAt !== null || codigo.expiresAt <= now || codigo.usosRestantes <= 0) {
        return { kind: 'agotado' as const };
      }
      codigo.usosRestantes -= 1;
      codigo.registradoUsuarioId = usuarioId;
      void organizationId;
      void rol;
      return { kind: 'ok' as const };
    },
  };

  return { repo, users, codigos, invitaciones };
}

const ADMIN: Requester = { id: 'admin-1', organizationId: 'org-1', name: 'Ada Admin', rol: 'ADMIN' };
const LIDER: Requester = { id: 'lider-1', organizationId: 'org-1', name: 'Leo Lider', rol: 'LIDER' };
const OTRO_LIDER: Requester = { id: 'lider-2', organizationId: 'org-1', name: 'Otro Lider', rol: 'LIDER' };
const SOCIO: Requester = { id: 'socio-1', organizationId: 'org-1', name: 'Sam Socio', rol: 'SOCIO' };

const JWT_SECRET = 'test-secret-not-used-for-real-auth-0000';
const NOW = new Date('2026-01-01T00:00:00.000Z');
const BRAND_ORG_1: OrganizacionPublicaConEstado = {
  brand: { slug: 'club-1', name: 'Club Uno', shortName: null, hasLogo: false, logoVersion: null },
  suspended: false,
};

function createDeps(overrides: Partial<CodigosQrDeps> = {}, extraUsers: FakeUser[] = []) {
  const seedUsers: FakeUser[] = [
    { id: ADMIN.id, organizationId: ADMIN.organizationId, email: 'admin@club.cl', name: ADMIN.name, rol: 'ADMIN', emailVerified: true },
    { id: LIDER.id, organizationId: LIDER.organizationId, email: 'lider@club.cl', name: LIDER.name, rol: 'LIDER', emailVerified: true },
    { id: OTRO_LIDER.id, organizationId: OTRO_LIDER.organizationId, email: 'lider2@club.cl', name: OTRO_LIDER.name, rol: 'LIDER', emailVerified: true },
    { id: SOCIO.id, organizationId: SOCIO.organizationId, email: 'socio@club.cl', name: SOCIO.name, rol: 'SOCIO', emailVerified: true },
    ...extraUsers,
  ];
  const { repo, users, codigos, invitaciones } = createFakeRepo(seedUsers);
  const sentEmails: SendCodigoQrInvitationEmailParams[] = [];
  const withOrgCalls: string[] = [];
  const errors: unknown[] = [];

  const deps: CodigosQrDeps = {
    repo,
    sendInvitationEmail: async (_organizationId, params) => {
      sentEmails.push(params);
    },
    getOrganizationPublic: async () => BRAND_ORG_1,
    withOrganization: async (organizationId, fn) => {
      withOrgCalls.push(organizationId);
      return fn();
    },
    hashPassword: async (password) => `hashed:${password}`,
    comparePassword: async (password, hash) => hash === `hashed:${password}`,
    now: () => NOW,
    frontendUrl: 'https://andinoclubpamir.app',
    jwtSecret: JWT_SECRET,
    logError: (error) => errors.push(error),
    ...overrides,
  };
  return { deps, users, codigos, invitaciones, sentEmails, withOrgCalls, errors };
}

// Espera lo suficiente para que un `.catch()` disparado sin `await` (fire-
// and-forget) ya haya corrido — un macrotask basta y sobra para agotar todos
// los microtasks pendientes de una promesa que rechaza inmediatamente.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ─── crearCodigoQr ──────────────────────────────────────────────────────────────

describe('crearCodigoQr', () => {
  it('un SOCIO no puede crear (403)', async () => {
    const { deps } = createDeps();
    const result = await crearCodigoQr(deps, SOCIO, {});
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it('ADMIN y LIDER sí pueden crear', async () => {
    const { deps } = createDeps();
    assert.equal((await crearCodigoQr(deps, ADMIN, {})).ok, true);
    assert.equal((await crearCodigoQr(deps, LIDER, {})).ok, true);
  });

  it('defaults: sin body, duración 24h y máximo 50 usos', async () => {
    const { deps } = createDeps();
    const result = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.codigo.maxUsos, 50);
    assert.equal(result.body.codigo.usosRestantes, 50);
    assert.equal(result.body.codigo.expiresAt.getTime(), NOW.getTime() + 24 * 60 * 60 * 1000);
  });

  it('duración inválida rechaza con 400', async () => {
    const { deps } = createDeps();
    const result = await crearCodigoQr(deps, ADMIN, { duracion: '3h' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it('maxUsos fuera de [1, 200] rechaza con 400', async () => {
    const { deps } = createDeps();
    assert.equal((await crearCodigoQr(deps, ADMIN, { maxUsos: 0 })).ok, false);
    assert.equal((await crearCodigoQr(deps, ADMIN, { maxUsos: 201 })).ok, false);
    assert.equal((await crearCodigoQr(deps, ADMIN, { maxUsos: 1.5 })).ok, false);
    assert.equal((await crearCodigoQr(deps, ADMIN, { maxUsos: 200 })).ok, true);
    assert.equal((await crearCodigoQr(deps, ADMIN, { maxUsos: 1 })).ok, true);
  });

  it('una etiqueta de más de 80 caracteres rechaza con 400', async () => {
    const { deps } = createDeps();
    const result = await crearCodigoQr(deps, ADMIN, { etiqueta: 'x'.repeat(81) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it('ignora organizationId/rol inyectados en el body: siempre el club del requester y rol SOCIO', async () => {
    const { deps, codigos } = createDeps();
    const result = await crearCodigoQr(deps, ADMIN, {
      // No forman parte del contrato de entrada.
      ...({ organizationId: 'org-intrusa', rol: 'ADMIN' } as Record<string, unknown>),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.codigo.rol, 'SOCIO');
    assert.equal(codigos[0]?.organizationId, ADMIN.organizationId);
    assert.equal(codigos[0]?.rol, 'SOCIO');
  });

  it('solo persiste el hash y el cifrado del token: el token en claro nunca queda guardado', async () => {
    const { deps, codigos } = createDeps();
    const result = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const token = result.body.qrUrl.split('#qr=')[1] ?? '';
    assert.ok(token.length > 0);

    const stored = codigos[0];
    assert.ok(stored);
    assert.ok(stored?.tokenHash);
    assert.ok(stored?.tokenCifrado);
    assert.notEqual(stored?.tokenHash, token);
    assert.notEqual(stored?.tokenCifrado, token);
    for (const value of Object.values(stored as unknown as Record<string, unknown>)) {
      if (typeof value === 'string') {
        assert.equal(value.includes(token), false);
      }
    }
  });
});

// ─── listarCodigosQr / verCodigoQr / revocarCodigoQr (visibilidad) ────────────

describe('listarCodigosQr', () => {
  it('un SOCIO no puede listar', async () => {
    const { deps } = createDeps();
    const result = await listarCodigosQr(deps, SOCIO);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it('ADMIN ve todos los del club; LIDER solo los suyos', async () => {
    const { deps } = createDeps();
    await crearCodigoQr(deps, ADMIN, {});
    await crearCodigoQr(deps, LIDER, {});
    await crearCodigoQr(deps, OTRO_LIDER, {});

    const comoAdmin = await listarCodigosQr(deps, ADMIN);
    assert.equal(comoAdmin.ok, true);
    if (comoAdmin.ok) assert.equal(comoAdmin.body.codigos.length, 3);

    const comoLider = await listarCodigosQr(deps, LIDER);
    assert.equal(comoLider.ok, true);
    if (comoLider.ok) {
      assert.equal(comoLider.body.codigos.length, 1);
      assert.equal(comoLider.body.codigos[0]?.creadoPor?.id, LIDER.id);
    }
  });
});

describe('verCodigoQr / revocarCodigoQr — visibilidad', () => {
  it('LIDER no puede ver ni revocar el código de otro LIDER (404, no revela existencia)', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, LIDER, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;

    const ver = await verCodigoQr(deps, OTRO_LIDER, creado.body.codigo.id);
    assert.equal(ver.ok, false);
    if (!ver.ok) assert.equal(ver.status, 404);

    const revocar = await revocarCodigoQr(deps, OTRO_LIDER, creado.body.codigo.id);
    assert.equal(revocar.ok, false);
    if (!revocar.ok) assert.equal(revocar.status, 404);
  });

  it('LIDER puede ver y revocar su propio código', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, LIDER, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;

    assert.equal((await verCodigoQr(deps, LIDER, creado.body.codigo.id)).ok, true);
    assert.equal((await revocarCodigoQr(deps, LIDER, creado.body.codigo.id)).ok, true);
  });

  it('ADMIN puede ver y revocar el código de cualquier LIDER del club', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, LIDER, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;

    assert.equal((await verCodigoQr(deps, ADMIN, creado.body.codigo.id)).ok, true);
    assert.equal((await revocarCodigoQr(deps, ADMIN, creado.body.codigo.id)).ok, true);
  });

  it('un id inexistente da 404 para ambos', async () => {
    const { deps } = createDeps();
    assert.equal((await verCodigoQr(deps, ADMIN, 'no-existe')).status, 404);
    assert.equal((await revocarCodigoQr(deps, ADMIN, 'no-existe')).status, 404);
  });

  it('ver/revocar un código no-activo (ya revocado) da 409', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;

    await revocarCodigoQr(deps, ADMIN, creado.body.codigo.id);

    const segundaRevocacion = await revocarCodigoQr(deps, ADMIN, creado.body.codigo.id);
    assert.equal(segundaRevocacion.ok, false);
    if (!segundaRevocacion.ok) assert.equal(segundaRevocacion.status, 409);

    const ver = await verCodigoQr(deps, ADMIN, creado.body.codigo.id);
    assert.equal(ver.ok, false);
    if (!ver.ok) assert.equal(ver.status, 409);
  });
});

describe('verCodigoQr — reapertura', () => {
  it('reabre un código ACTIVO y devuelve el mismo qrUrl que al crearlo', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;

    const visto = await verCodigoQr(deps, ADMIN, creado.body.codigo.id);
    assert.equal(visto.ok, true);
    if (visto.ok) assert.equal(visto.body.qrUrl, creado.body.qrUrl);
  });

  it('un tokenCifrado que no descifra con el secreto vigente da 409 ("otro entorno")', async () => {
    const { deps, codigos } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;

    // Simula un QR creado en otro entorno (otro JWT_SECRET): el cifrado
    // guardado ya no descifra con el secreto vigente.
    const stored = codigos.find((c) => c.id === creado.body.codigo.id);
    assert.ok(stored);
    stored!.tokenCifrado = cifrarTokenQr('token-cualquiera', 'otro-secreto-completamente-distinto');

    const visto = await verCodigoQr(deps, ADMIN, creado.body.codigo.id);
    assert.equal(visto.ok, false);
    if (!visto.ok) {
      assert.equal(visto.status, 409);
      assert.match(visto.error, /otro entorno/);
    }
  });
});

// ─── consultarCodigoQr (público) ───────────────────────────────────────────────

describe('consultarCodigoQr', () => {
  it('token desconocido da 404', async () => {
    const { deps } = createDeps();
    const result = await consultarCodigoQr(deps, 'token-inexistente');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it('devuelve EXACTAMENTE { organization, expiresAt, modo } — nunca usos ni contadores', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await consultarCodigoQr(deps, token);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(Object.keys(result.body).sort(), ['expiresAt', 'modo', 'organization']);
    assert.deepEqual(result.body.organization, BRAND_ORG_1.brand);
    assert.equal(result.body.expiresAt.getTime(), creado.body.codigo.expiresAt.getTime());
    assert.equal(result.body.modo, 'CORREO');
  });

  it('un código revocado da 410', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    await revocarCodigoQr(deps, ADMIN, creado.body.codigo.id);
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await consultarCodigoQr(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });

  it('un código expirado da 410', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, { duracion: '2h' });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const depsFuturo: CodigosQrDeps = { ...deps, now: () => new Date(NOW.getTime() + 3 * 60 * 60 * 1000) };
    const result = await consultarCodigoQr(depsFuturo, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });

  it('un código agotado (usosRestantes 0) da 410', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, { maxUsos: 1 });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const primera = await solicitarInvitacionQr(deps, token, { email: 'usa-el-unico@club.cl' });
    assert.equal(primera.ok, true);

    const result = await consultarCodigoQr(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });

  it('un club suspendido da 410', async () => {
    const { deps } = createDeps({ getOrganizationPublic: async () => ({ ...BRAND_ORG_1, suspended: true }) });
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await consultarCodigoQr(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });

  it('si quien creó el código ya no existe, da 410', async () => {
    const { deps, users } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    users.splice(users.findIndex((u) => u.id === ADMIN.id), 1);

    const result = await consultarCodigoQr(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });

  it('si quien creó el código fue degradado y ya no puede invitar SOCIO, da 410', async () => {
    const { deps, users } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    // No hay rol por debajo de SOCIO que además pueda invitar: se simula con
    // un rol fuera del enum esperado por puedeInvitarRol.
    const admin = users.find((u) => u.id === ADMIN.id);
    if (admin) admin.rol = 'SOCIO';

    const result = await consultarCodigoQr(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });
});

// ─── solicitarInvitacionQr (público) ───────────────────────────────────────────

describe('solicitarInvitacionQr', () => {
  // Crea un código CORREO activo con maxUsos alto (por defecto 50, salvo que
  // el propio test lo agote) y devuelve solo el token — la mayoría de los
  // tests de este describe solo necesitan eso, no el resto de creado.body.
  async function crearQrActivo(deps: CodigosQrDeps, requester: Requester = ADMIN): Promise<string> {
    const creado = await crearCodigoQr(deps, requester, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) throw new Error('no se pudo crear el código QR');
    return creado.body.qrUrl.split('#qr=')[1] ?? '';
  }

  it('un email con cuenta en OTRO club ya no se ignora: mintea la invitación igual que a un email nuevo', async () => {
    const { deps, invitaciones, users } = createDeps({}, [
      { id: 'u5', organizationId: 'otro-club', email: 'qr-otro-club@club.cl', name: 'QR Otro', rol: 'SOCIO', emailVerified: true },
    ]);
    void users;
    const qrToken = await crearQrActivo(deps, ADMIN);
    const result = await solicitarInvitacionQr(deps, qrToken, { email: 'qr-otro-club@club.cl' });
    assert.equal(result.ok, true);
    assert.equal(invitaciones.some((i) => i.email === 'qr-otro-club@club.cl'), true);
  });

  it('un email YA socio de este club sigue sin mintear nada (silencioso, mismo 202 genérico)', async () => {
    const { deps, invitaciones } = createDeps({}, [
      { id: 'u6', organizationId: ADMIN.organizationId, email: 'qr-ya-socio@club.cl', name: 'QR Ya Socio', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrActivo(deps, ADMIN);
    const result = await solicitarInvitacionQr(deps, qrToken, { email: 'qr-ya-socio@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.message, MENSAJE_SOLICITUD_GENERICA);
    assert.equal(invitaciones.some((i) => i.email === 'qr-ya-socio@club.cl'), false);
  });

  it('el correo mezcla viaQr y existingAccount cuando ambos aplican', async () => {
    const { deps, sentEmails } = createDeps({}, [
      { id: 'u7', organizationId: 'otro-club', email: 'qr-viaqr-existente@club.cl', name: 'QR Existente', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrActivo(deps, ADMIN);
    await solicitarInvitacionQr(deps, qrToken, { email: 'qr-viaqr-existente@club.cl' });
    assert.equal((sentEmails[0] as { existingAccount: boolean }).existingAccount, true);
  });

  it('con un email nuevo mintea una Invitacion SOCIO y envía el correo', async () => {
    const { deps, invitaciones, sentEmails } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await solicitarInvitacionQr(deps, token, { email: 'nuevo@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.message, MENSAJE_SOLICITUD_GENERICA);

    assert.equal(invitaciones.length, 1);
    assert.equal(invitaciones[0]?.email, 'nuevo@club.cl');
    assert.equal(invitaciones[0]?.rol, 'SOCIO');
    assert.equal(invitaciones[0]?.invitadoPorId, ADMIN.id);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0]?.to, 'nuevo@club.cl');
  });

  it('withOrganization se llama con el club del código', async () => {
    const { deps, withOrgCalls } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    await solicitarInvitacionQr(deps, token, { email: 'nuevo@club.cl' });
    assert.deepEqual(withOrgCalls, [ADMIN.organizationId]);
  });

  it('un email inválido rechaza con 400 sin mintear nada', async () => {
    const { deps, invitaciones } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await solicitarInvitacionQr(deps, token, { email: 'no-es-un-email' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
    assert.equal(invitaciones.length, 0);
  });

  it('la validez del token se comprueba ANTES que el email: un token no vigente da 410/404 aunque el email también sea inválido', async () => {
    const { deps } = createDeps();
    const result = await solicitarInvitacionQr(deps, 'token-inexistente', { email: 'no-es-un-email' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it('cuenta existente / invitación pendiente / email nuevo: exactamente la misma respuesta 202 (deepEqual)', async () => {
    const { deps, users, invitaciones } = createDeps({}, [
      { id: 'existing-1', organizationId: 'org-1', email: 'existe@club.cl', name: 'Ya Existe', rol: 'SOCIO', emailVerified: true },
    ]);
    void users;
    const creado = await crearCodigoQr(deps, ADMIN, { maxUsos: 200 });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    // Pre-siembra una invitación pendiente para "pendiente@club.cl" (como si
    // la hubiera creado otro flujo, p. ej. una invitación individual).
    invitaciones.push({
      id: 'pre-pendiente',
      organizationId: 'org-1',
      email: 'pendiente@club.cl',
      rol: 'ADMIN',
      tokenHash: 'hash-preexistente',
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      invitadoPorId: ADMIN.id,
      emitidaPorPlataforma: false,
      aceptadaAt: null,
      usuarioId: null,
      revocadaAt: null,
      createdAt: NOW,
    });

    const porCuentaExistente = await solicitarInvitacionQr(deps, token, { email: 'existe@club.cl' });
    const porPendiente = await solicitarInvitacionQr(deps, token, { email: 'pendiente@club.cl' });
    const porEmailNuevo = await solicitarInvitacionQr(deps, token, { email: 'nuevo-de-verdad@club.cl' });

    assert.deepEqual(porCuentaExistente, porPendiente);
    assert.deepEqual(porPendiente, porEmailNuevo);
    assert.equal(porEmailNuevo.ok, true);
    if (porEmailNuevo.ok) assert.equal(porEmailNuevo.body.message, MENSAJE_SOLICITUD_GENERICA);
  });

  it('una invitación ADMIN pendiente para ese email NUNCA se revoca (a diferencia de crearInvitacion)', async () => {
    const { deps, invitaciones } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const pendienteAdmin: InvitacionRow = {
      id: 'pre-pendiente-admin',
      organizationId: 'org-1',
      email: 'objetivo@club.cl',
      rol: 'ADMIN',
      tokenHash: 'hash-preexistente-admin',
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      invitadoPorId: ADMIN.id,
      emitidaPorPlataforma: false,
      aceptadaAt: null,
      usuarioId: null,
      revocadaAt: null,
      createdAt: NOW,
    };
    invitaciones.push(pendienteAdmin);

    await solicitarInvitacionQr(deps, token, { email: 'objetivo@club.cl' });

    assert.equal(invitaciones.length, 1);
    const sigue = invitaciones.find((i) => i.id === 'pre-pendiente-admin');
    assert.equal(sigue?.revocadaAt, null);
    assert.equal(sigue?.rol, 'ADMIN');
  });

  it('una carrera perdida en el último uso no mintea ni envía correo, pero igual responde 202', async () => {
    const { deps, invitaciones, sentEmails } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, { maxUsos: 1 });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    // Simula que otra solicitud concurrente ya consumió el último uso justo
    // antes del minteo (verificarVigenciaQr ya había pasado la validación).
    const depsQueAgotaAlMintear: CodigosQrDeps = {
      ...deps,
      repo: {
        ...deps.repo,
        async mintInvitacion() {
          return null;
        },
      },
    };

    const result = await solicitarInvitacionQr(depsQueAgotaAlMintear, token, { email: 'pierde-la-carrera@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.message, MENSAJE_SOLICITUD_GENERICA);
    assert.equal(invitaciones.length, 0);
    assert.equal(sentEmails.length, 0);
  });

  it('un fallo al enviar el correo no impide la respuesta 202 (fire-and-forget, se registra con logError)', async () => {
    const { deps, errors, invitaciones } = createDeps({
      sendInvitationEmail: async () => {
        throw new Error('SMTP down');
      },
    });
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await solicitarInvitacionQr(deps, token, { email: 'correo-falla@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.message, MENSAJE_SOLICITUD_GENERICA);
    // La invitación SÍ se minteó (el fallo es solo del envío, no del minteo).
    assert.equal(invitaciones.length, 1);

    await flushMicrotasks();
    assert.equal(errors.length, 1);
  });

  it('un código revocado/expirado/agotado da 410 y nunca mintea', async () => {
    const { deps, invitaciones } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';
    await revocarCodigoQr(deps, ADMIN, creado.body.codigo.id);

    const result = await solicitarInvitacionQr(deps, token, { email: 'no-deberia-mintear@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
    assert.equal(invitaciones.length, 0);
  });

  it('un club suspendido da 410 y nunca mintea', async () => {
    const { deps: depsSuspendido, invitaciones } = createDeps({
      getOrganizationPublic: async () => ({ ...BRAND_ORG_1, suspended: true }),
    });
    const creado = await crearCodigoQr(depsSuspendido, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await solicitarInvitacionQr(depsSuspendido, token, { email: 'club-suspendido@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
    assert.equal(invitaciones.length, 0);
  });
});

// ─── Modo DIRECTO ("QR directo") ────────────────────────────────────────────────

describe('crearCodigoQr — modo DIRECTO', () => {
  it('fuerza TTL de 15 minutos y 1 uso, sin importar duracion/maxUsos del body', async () => {
    const { deps } = createDeps();
    const result = await crearCodigoQr(deps, ADMIN, { modo: 'DIRECTO', duracion: '7d', maxUsos: 200 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.codigo.modo, 'DIRECTO');
    assert.equal(result.body.codigo.maxUsos, 1);
    assert.equal(result.body.codigo.usosRestantes, 1);
    assert.equal(result.body.codigo.expiresAt.getTime(), NOW.getTime() + QR_DIRECTO_TTL_MS);
  });

  it('un modo inválido rechaza con 400', async () => {
    const { deps } = createDeps();
    const result = await crearCodigoQr(deps, ADMIN, { modo: 'OTRO' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it('sin modo en el body, el comportamiento sigue siendo CORREO', async () => {
    const { deps } = createDeps();
    const result = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.codigo.modo, 'CORREO');
  });
});

describe('listarCodigosQr — modo DIRECTO', () => {
  it('un código DIRECTO ya agotado deja de listarse; uno todavía ACTIVO sí se lista', async () => {
    const { deps } = createDeps();
    const activo = await crearCodigoQr(deps, ADMIN, { modo: 'DIRECTO' });
    const agotado = await crearCodigoQr(deps, ADMIN, { modo: 'DIRECTO' });
    assert.equal(activo.ok, true);
    assert.equal(agotado.ok, true);
    if (!activo.ok || !agotado.ok) return;
    const tokenAgotado = agotado.body.qrUrl.split('#qr=')[1] ?? '';
    const registrado = await registrarConQrDirecto(deps, tokenAgotado, {
      name: 'Se Agota',
      email: 'se-agota@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(registrado.ok, true);

    const listado = await listarCodigosQr(deps, ADMIN);
    assert.equal(listado.ok, true);
    if (!listado.ok) return;
    const ids = listado.body.codigos.map((c) => c.id);
    assert.ok(ids.includes(activo.body.codigo.id));
    assert.equal(ids.includes(agotado.body.codigo.id), false);
  });

  it('un código CORREO se lista en cualquier estado, como siempre', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    await revocarCodigoQr(deps, ADMIN, creado.body.codigo.id);

    const listado = await listarCodigosQr(deps, ADMIN);
    assert.equal(listado.ok, true);
    if (!listado.ok) return;
    assert.ok(listado.body.codigos.some((c) => c.id === creado.body.codigo.id));
  });
});

describe('estadoCodigoQr', () => {
  it('un SOCIO no puede consultar (403)', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, { modo: 'DIRECTO' });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const result = await estadoCodigoQr(deps, SOCIO, creado.body.codigo.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it('LIDER no puede consultar el código de otro LIDER (404, no revela existencia)', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, LIDER, { modo: 'DIRECTO' });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const result = await estadoCodigoQr(deps, OTRO_LIDER, creado.body.codigo.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it('un id inexistente da 404', async () => {
    const { deps } = createDeps();
    const result = await estadoCodigoQr(deps, ADMIN, 'no-existe');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it('mientras nadie escanea, estado ACTIVO y registrado null', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, { modo: 'DIRECTO' });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const result = await estadoCodigoQr(deps, ADMIN, creado.body.codigo.id);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.estado, 'ACTIVO');
    assert.equal(result.body.registrado, null);
  });

  it('tras un registro exitoso, estado AGOTADO y registrado con nombre/email — SIN exigir que siga ACTIVO', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, { modo: 'DIRECTO' });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const registrado = await registrarConQrDirecto(deps, token, {
      name: 'Nueva Persona',
      email: 'nueva-persona@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(registrado.ok, true);

    const result = await estadoCodigoQr(deps, ADMIN, creado.body.codigo.id);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.estado, 'AGOTADO');
    assert.deepEqual(result.body.registrado, { name: 'Nueva Persona', email: 'nueva-persona@club.cl' });
  });
});

describe('solicitarInvitacionQr — modo DIRECTO', () => {
  it('un token DIRECTO da 404, como si fuera desconocido — nunca mintea', async () => {
    const { deps, invitaciones } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, { modo: 'DIRECTO' });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await solicitarInvitacionQr(deps, token, { email: 'no-deberia-mintear@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
    assert.equal(invitaciones.length, 0);
  });
});

describe('consultarCodigoQr — modo DIRECTO', () => {
  it('devuelve modo: DIRECTO para un código directo', async () => {
    const { deps } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, { modo: 'DIRECTO' });
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await consultarCodigoQr(deps, token);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.modo, 'DIRECTO');
  });
});

describe('registrarConQrDirecto', () => {
  async function crearDirecto(deps: CodigosQrDeps, requester: Requester = ADMIN) {
    const creado = await crearCodigoQr(deps, requester, { modo: 'DIRECTO' });
    assert.equal(creado.ok, true);
    if (!creado.ok) throw new Error('no se pudo crear el código DIRECTO');
    return { id: creado.body.codigo.id, token: creado.body.qrUrl.split('#qr=')[1] ?? '' };
  }

  it('un token de modo CORREO da 404, como si fuera desconocido', async () => {
    const { deps, users } = createDeps();
    const creado = await crearCodigoQr(deps, ADMIN, {});
    assert.equal(creado.ok, true);
    if (!creado.ok) return;
    const token = creado.body.qrUrl.split('#qr=')[1] ?? '';

    const result = await registrarConQrDirecto(deps, token, {
      name: 'Cualquiera',
      email: 'cualquiera@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
    assert.equal(users.some((u) => u.email === 'cualquiera@club.cl'), false);
  });

  it('un token desconocido da 404', async () => {
    const { deps } = createDeps();
    const result = await registrarConQrDirecto(deps, 'token-inexistente', {
      name: 'Cualquiera',
      email: 'cualquiera@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it('camino feliz: crea un SOCIO en el club del QR, emailVerified true, y fija registradoUsuarioId', async () => {
    const { deps, users, codigos } = createDeps();
    const { id, token } = await crearDirecto(deps);

    const result = await registrarConQrDirecto(deps, token, {
      name: 'Persona Nueva',
      email: 'persona-nueva@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.body, { ok: true });

    const creado = users.find((u) => u.email === 'persona-nueva@club.cl');
    assert.ok(creado);
    assert.equal(creado?.organizationId, ADMIN.organizationId);
    assert.equal(creado?.rol, 'SOCIO');
    assert.equal(creado?.emailVerified, true);

    const codigo = codigos.find((c) => c.id === id);
    assert.equal(codigo?.usosRestantes, 0);
    assert.equal(codigo?.registradoUsuarioId, creado?.id);
  });

  it('un segundo registro sobre el mismo código (ya agotado) da 410', async () => {
    const { deps } = createDeps();
    const { token } = await crearDirecto(deps);

    const primero = await registrarConQrDirecto(deps, token, {
      name: 'Primera',
      email: 'primera@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(primero.ok, true);

    const segundo = await registrarConQrDirecto(deps, token, {
      name: 'Segunda',
      email: 'segunda@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(segundo.ok, false);
    if (!segundo.ok) assert.equal(segundo.status, 410);
  });

  // La rama "email ya registrado" ahora pertenece al flujo de cuenta
  // existente (ver 'registrarConQrDirecto — cuenta existente' más abajo, que
  // reemplaza a este caso: con la contraseña incorrecta responde 401, no
  // 409, y tampoco consume el uso).

  it('nombre/email/contraseña inválidos rechazan con 400 y no consumen el uso', async () => {
    const { deps, codigos } = createDeps();
    const { id, token } = await crearDirecto(deps);

    const sinNombre = await registrarConQrDirecto(deps, token, {
      name: '',
      email: 'valido@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(sinNombre.ok, false);
    if (!sinNombre.ok) assert.equal(sinNombre.status, 400);

    const emailInvalido = await registrarConQrDirecto(deps, token, {
      name: 'Alguien',
      email: 'no-es-un-email',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(emailInvalido.ok, false);
    if (!emailInvalido.ok) assert.equal(emailInvalido.status, 400);

    const passwordCorta = await registrarConQrDirecto(deps, token, {
      name: 'Alguien',
      email: 'valido@club.cl',
      password: '123',
    }, { verifiedEmail: null });
    assert.equal(passwordCorta.ok, false);
    if (!passwordCorta.ok) assert.equal(passwordCorta.status, 400);

    const codigo = codigos.find((c) => c.id === id);
    assert.equal(codigo?.usosRestantes, 1);
  });

  it('una carrera perdida por el único uso da 410', async () => {
    const { deps } = createDeps();
    const { token } = await crearDirecto(deps);

    const depsQueAgota: CodigosQrDeps = {
      ...deps,
      repo: {
        ...deps.repo,
        async registrarUsuarioQrDirecto() {
          return { kind: 'agotado' };
        },
      },
    };

    const result = await registrarConQrDirecto(depsQueAgota, token, {
      name: 'Pierde La Carrera',
      email: 'pierde-carrera@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });

  it('una carrera perdida contra otra request para el MISMO email (unique violation) da 409', async () => {
    const { deps } = createDeps();

    // El chequeo previo (findAccountForOwnershipProof) pasa como si el email
    // estuviera libre, pero registrarUsuarioQrDirecto detecta el choque al
    // escribir — misma carrera que P2002 en el repo Prisma real.
    const depsSinChequeoPrevio: CodigosQrDeps = {
      ...deps,
      repo: {
        ...deps.repo,
        async findAccountForOwnershipProof() {
          return null;
        },
      },
    };

    const { token: token1 } = await crearDirecto(deps);
    const primero = await registrarConQrDirecto(
      depsSinChequeoPrevio,
      token1,
      { name: 'Primera', email: 'choque@club.cl', password: 'password123' },
      { verifiedEmail: null },
    );
    assert.equal(primero.ok, true);

    const { token: token2 } = await crearDirecto(deps);
    const segundo = await registrarConQrDirecto(
      depsSinChequeoPrevio,
      token2,
      { name: 'Segunda', email: 'choque@club.cl', password: 'password123' },
      { verifiedEmail: null },
    );
    assert.equal(segundo.ok, false);
    if (!segundo.ok) assert.equal(segundo.status, 409);
  });

  it('un código revocado da 410', async () => {
    const { deps } = createDeps();
    const { id, token } = await crearDirecto(deps);
    await revocarCodigoQr(deps, ADMIN, id);

    const result = await registrarConQrDirecto(deps, token, {
      name: 'Cualquiera',
      email: 'revocado@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });

  it('un código expirado da 410', async () => {
    const { deps } = createDeps();
    const { token } = await crearDirecto(deps);
    const depsFuturo: CodigosQrDeps = { ...deps, now: () => new Date(NOW.getTime() + QR_DIRECTO_TTL_MS + 1) };

    const result = await registrarConQrDirecto(depsFuturo, token, {
      name: 'Cualquiera',
      email: 'expirado@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });

  it('withOrganization se llama con el club del QR', async () => {
    const { deps, withOrgCalls } = createDeps();
    const { token } = await crearDirecto(deps);

    await registrarConQrDirecto(deps, token, {
      name: 'Alguien',
      email: 'org-check@club.cl',
      password: 'password123',
    }, { verifiedEmail: null });
    assert.deepEqual(withOrgCalls, [ADMIN.organizationId]);
  });
});

// ─── registrarConQrDirecto — cuenta existente (PR "Joining") ──────────────────

describe('registrarConQrDirecto — cuenta existente (PR "Joining")', () => {
  // Igual que crearQrActivo (describe('solicitarInvitacionQr')), pero para
  // modo DIRECTO: crea el código y devuelve solo el token — la mayoría de
  // los tests de este describe solo necesitan eso.
  async function crearQrDirectoActivo(deps: CodigosQrDeps, requester: Requester = ADMIN): Promise<string> {
    const creado = await crearCodigoQr(deps, requester, { modo: 'DIRECTO' });
    assert.equal(creado.ok, true);
    if (!creado.ok) throw new Error('no se pudo crear el código DIRECTO');
    return creado.body.qrUrl.split('#qr=')[1] ?? '';
  }

  it('con la contraseña correcta, crea SOLO la Membresia y consume el único uso', async () => {
    const { deps, codigos } = createDeps({}, [
      { id: 'qr-existente-1', organizationId: 'otro-club', email: 'qr-existe@club.cl', name: 'Nombre Original', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrDirectoActivo(deps, ADMIN);
    const result = await registrarConQrDirecto(
      deps,
      qrToken,
      { name: 'Se Ignora', email: 'qr-existe@club.cl', password: 'qr-existe@club.cl-password' },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, true);
    const codigo = codigos.find((c) => c.modo === 'DIRECTO');
    assert.equal(codigo?.usosRestantes, 0);
  });

  it('con la contraseña incorrecta, responde 401 y no consume el uso', async () => {
    const { deps, codigos } = createDeps({}, [
      { id: 'qr-existente-2', organizationId: 'otro-club', email: 'qr-mal@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrDirectoActivo(deps, ADMIN);
    const result = await registrarConQrDirecto(
      deps,
      qrToken,
      { name: 'X', email: 'qr-mal@club.cl', password: 'incorrecta' },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    const codigo = codigos.find((c) => c.modo === 'DIRECTO');
    assert.equal(codigo?.usosRestantes, 1);
    assert.equal(codigo?.registradoUsuarioId, null);
  });

  it('con un Bearer de OTRO email, responde 403 "Este código es para otro correo"', async () => {
    const { deps } = createDeps({}, [
      { id: 'qr-existente-3', organizationId: 'otro-club', email: 'qr-mismatch@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const qrToken = await crearQrDirectoActivo(deps, ADMIN);
    const result = await registrarConQrDirecto(
      deps,
      qrToken,
      { name: 'X', email: 'qr-mismatch@club.cl', password: undefined },
      { verifiedEmail: 'alguien-mas@club.cl' },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error, 'Este código es para otro correo');
    }
  });

  it('sin cuenta existente, el comportamiento de siempre no cambia (regresión)', async () => {
    const { deps } = createDeps();
    const qrToken = await crearQrDirectoActivo(deps, ADMIN);
    const result = await registrarConQrDirecto(
      deps,
      qrToken,
      { name: 'Nuevo', email: 'qr-nuevo-directo@club.cl', password: 'password123' },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, true);
  });
});
