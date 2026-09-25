import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RolUsuario } from '../generated/prisma/client.js';
import {
  crearInvitacion,
  listarInvitaciones,
  revocarInvitacion,
  reenviarInvitacion,
  consultarInvitacion,
  aceptarInvitacion,
  crearInvitacionPlataforma,
  type InvitacionesDeps,
  type InvitacionesRepo,
  type InvitacionRow,
  type CrearInvitacionBody,
} from './invitaciones.service.js';

// El token siempre viaja como fragmento (#invite=...) en inviteUrl — nunca
// llega al servidor por sí solo, así que cada test que necesita aceptar una
// invitación tiene que extraerlo de la URL devuelta por crearInvitacion.
function extractTokenFromInviteUrl(inviteUrl: string): string {
  return new URL(inviteUrl).hash.replace('#invite=', '');
}

// Compara dos CrearInvitacionBody ignorando SOLO lo que legítimamente varía
// entre dos invitaciones distintas (id, timestamps, token) — usada por las
// pruebas de invariancia de enumeración de reenviarInvitacion/
// crearInvitacionPlataforma (deferred finding de Task 2, Review Focus #2):
// si una rama dependiente de "cuenta existente en otro club" empezara a
// devolver un campo de más, uno de menos, o un valor distinto de
// emailEnviado/rol/estado, el deepEqual de la prueba dejaría de pasar.
function normalizarCrearInvitacionBody(body: CrearInvitacionBody): unknown {
  return {
    invitacion: { ...body.invitacion, id: '<id>', createdAt: '<createdAt>', expiresAt: '<expiresAt>' },
    inviteUrl: body.inviteUrl.replace(/#invite=.+$/, '#invite=<token>'),
    emailEnviado: body.emailEnviado,
  };
}

// ─── Fake repo (en memoria, sin Prisma) ────────────────────────────────────────

interface FakeUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  rol: RolUsuario;
  emailVerified: boolean;
}

// Solo la rama de "cuenta existente" de aceptarInvitacion escribe acá (ver
// acceptInvitacionExistente más abajo) — el fake nunca modeló Membresia como
// tabla propia del flujo de cuenta nueva (ver el comentario de
// findAccountMembershipStatus), así que esto existe únicamente para poder
// afirmar, en las pruebas de cuenta existente, con qué rol/organizationId se
// llamó de verdad al repositorio (nunca los que traiga el body).
interface FakeMembresia {
  organizationId: string;
  usuarioId: string;
  rol: RolUsuario;
}

function createFakeRepo(seedUsers: FakeUser[] = []): {
  repo: InvitacionesRepo;
  users: FakeUser[];
  invitaciones: InvitacionRow[];
  membresias: FakeMembresia[];
} {
  const users = [...seedUsers];
  const invitaciones: InvitacionRow[] = [];
  const membresias: FakeMembresia[] = [];
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${++seq}`;

  const repo: InvitacionesRepo = {
    async findUserById(id) {
      const u = users.find((x) => x.id === id);
      return u ? { id: u.id, name: u.name, rol: u.rol } : null;
    },
    async findAccountMembershipStatus(email, organizationId) {
      const u = users.find((x) => x.email === email);
      if (!u) return { cuentaExiste: false, esSocioDeEsteClub: false };
      // El fake modela "socio de este club" como u.organizationId ===
      // organizationId — una simplificación deliberada: este repositorio en
      // memoria nunca modeló Membresia como una tabla propia (solo User),
      // así que "socia de este club" es, para el fake, "su organizationId
      // ES este club". Suficiente para las pruebas de crearInvitacion/
      // reenviarInvitacion/crearInvitacionPlataforma, que solo necesitan
      // distinguir "mismo club" de "cualquier otra cosa".
      return { cuentaExiste: true, esSocioDeEsteClub: u.organizationId === organizationId };
    },
    async findAccountForOwnershipProof(email) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id, email: u.email, passwordHash: `hashed:${u.email}-password` } : null;
    },
    async revokePendingForEmail(email, now) {
      for (const inv of invitaciones) {
        if (inv.email === email && !inv.aceptadaAt && !inv.revocadaAt && inv.expiresAt > now) {
          inv.revocadaAt = now;
        }
      }
    },
    async createInvitacion(data) {
      const row: InvitacionRow = {
        id: nextId('inv'),
        organizationId: data.organizationId,
        email: data.email,
        rol: data.rol,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        invitadoPorId: data.invitadoPorId,
        emitidaPorPlataforma: data.emitidaPorPlataforma,
        aceptadaAt: null,
        usuarioId: null,
        revocadaAt: null,
        createdAt: new Date(),
      };
      invitaciones.push(row);
      return row;
    },
    async findByTokenHash(tokenHash) {
      return invitaciones.find((i) => i.tokenHash === tokenHash) ?? null;
    },
    async findById(id) {
      return invitaciones.find((i) => i.id === id) ?? null;
    },
    async list({ invitadoPorId }) {
      return invitaciones
        .filter((i) => invitadoPorId === undefined || i.invitadoPorId === invitadoPorId)
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((i) => ({
          ...i,
          invitadoPorNombre: users.find((u) => u.id === i.invitadoPorId)?.name ?? null,
        }));
    },
    async markRevoked(id, now) {
      const inv = invitaciones.find((i) => i.id === id);
      if (inv) inv.revocadaAt = now;
    },
    async acceptInvitacion({ invitacionId, organizationId, email, name, passwordHash, rol, now }) {
      void passwordHash;
      const inv = invitaciones.find((i) => i.id === invitacionId);
      if (!inv || inv.aceptadaAt !== null || inv.revocadaAt !== null || inv.expiresAt <= now) {
        return null;
      }
      inv.aceptadaAt = now;
      const user: FakeUser = { id: nextId('user'), organizationId, email, name, rol, emailVerified: true };
      users.push(user);
      inv.usuarioId = user.id;
      return { id: user.id, email: user.email, name: user.name, rol: user.rol };
    },
    async acceptInvitacionExistente({ invitacionId, organizationId, usuarioId, rol, now }) {
      const inv = invitaciones.find((i) => i.id === invitacionId);
      if (!inv || inv.aceptadaAt !== null || inv.revocadaAt !== null || inv.expiresAt <= now) {
        return false;
      }
      inv.aceptadaAt = now;
      inv.usuarioId = usuarioId;
      membresias.push({ organizationId, usuarioId, rol });
      return true;
    },
  };

  return { repo, users, invitaciones, membresias };
}

// Todo Requester usado como invitador debe existir como fila de usuario en el
// repositorio: verificarVigencia comprueba la autoridad ACTUAL de quien invitó
// (findUserById), no la que tenía en el momento de invitar.
function createDeps(overrides: Partial<InvitacionesDeps> = {}, extraUsers: FakeUser[] = []) {
  const seedUsers: FakeUser[] = [
    { id: ADMIN.id, organizationId: ADMIN.organizationId, email: 'admin@club.cl', name: ADMIN.name, rol: 'ADMIN', emailVerified: true },
    { id: LIDER.id, organizationId: LIDER.organizationId, email: 'lider@club.cl', name: LIDER.name, rol: 'LIDER', emailVerified: true },
    { id: SOCIO.id, organizationId: SOCIO.organizationId, email: 'socio@club.cl', name: SOCIO.name, rol: 'SOCIO', emailVerified: true },
    ...extraUsers,
  ];
  const { repo, users, invitaciones, membresias } = createFakeRepo(seedUsers);
  const sentEmails: unknown[] = [];
  const deps: InvitacionesDeps = {
    repo,
    sendEmail: async (params) => {
      sentEmails.push(params);
    },
    hashPassword: async (password) => `hashed:${password}`,
    comparePassword: async (password, hash) => hash === `hashed:${password}`,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    frontendUrl: 'https://andinoclubpamir.app',
    // Club de ADMIN/LIDER/SOCIO (org-1) — el mismo para los tres, como sus
    // organizationId.
    organizationSlug: 'club-test',
    ...overrides,
  };
  return { deps, users, invitaciones, membresias, sentEmails };
}

const ADMIN = { id: 'admin-1', organizationId: 'org-1', name: 'Ada Admin', rol: 'ADMIN' as RolUsuario };
const LIDER = { id: 'lider-1', organizationId: 'org-1', name: 'Leo Lider', rol: 'LIDER' as RolUsuario };
const SOCIO = { id: 'socio-1', organizationId: 'org-1', name: 'Sam Socio', rol: 'SOCIO' as RolUsuario };

// ─── crearInvitacion ────────────────────────────────────────────────────────────

describe('crearInvitacion', () => {
  it('LIDER puede invitar a un SOCIO', async () => {
    const { deps } = createDeps();
    const result = await crearInvitacion(deps, LIDER, { email: 'nuevo@club.cl', rol: 'SOCIO' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 201);
      assert.equal(result.body.invitacion.rol, 'SOCIO');
      assert.equal(result.body.emailEnviado, true);
    }
  });

  it('LIDER no puede invitar a un LIDER', async () => {
    const { deps } = createDeps();
    const result = await crearInvitacion(deps, LIDER, { email: 'nuevo@club.cl', rol: 'LIDER' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error, 'No puedes invitar con ese rol');
    }
  });

  it('LIDER no puede invitar a un ADMIN', async () => {
    const { deps } = createDeps();
    const result = await crearInvitacion(deps, LIDER, { email: 'nuevo@club.cl', rol: 'ADMIN' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it('un requester SOCIO no puede invitar', async () => {
    const { deps } = createDeps();
    const result = await crearInvitacion(deps, SOCIO, { email: 'nuevo@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error, 'No tienes permiso para invitar');
    }
  });

  it('un email con cuenta en OTRO club ya no se rechaza: se invita igual que a un email nuevo', async () => {
    const { deps, sentEmails } = createDeps({}, [
      { id: 'u1', organizationId: 'otro-club', email: 'ya@club.cl', name: 'Ya', rol: 'SOCIO', emailVerified: true },
    ]);
    const result = await crearInvitacion(deps, ADMIN, { email: 'ya@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 201);
      assert.equal(result.body.emailEnviado, true);
    }
    assert.equal(sentEmails.length, 1);
  });

  it('rechaza con 409 "Ya es socio de este club" si la cuenta YA es socia del club que invita', async () => {
    const { deps } = createDeps({}, [
      { id: 'u1', organizationId: ADMIN.organizationId, email: 'ya@club.cl', name: 'Ya', rol: 'SOCIO', emailVerified: true },
    ]);
    const result = await crearInvitacion(deps, ADMIN, { email: 'ya@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, 'Ya es socio de este club');
    }
  });

  it('la respuesta (ok/status/forma del body) es IDÉNTICA para un email sin cuenta y un email con cuenta en otro club — nunca revela cuál fue (enumeración, Review Focus #2)', async () => {
    const { deps: depsNuevo } = createDeps();
    const { deps: depsOtroClub } = createDeps({}, [
      { id: 'u2', organizationId: 'otro-club', email: 'otro-club@club.cl', name: 'Otro', rol: 'SOCIO', emailVerified: true },
    ]);
    const nuevo = await crearInvitacion(depsNuevo, ADMIN, { email: 'nunca-existio@club.cl' });
    const existente = await crearInvitacion(depsOtroClub, ADMIN, { email: 'otro-club@club.cl' });
    assert.equal(nuevo.ok, existente.ok);
    if (nuevo.ok && existente.ok) {
      assert.equal(nuevo.status, existente.status);
      assert.deepEqual(Object.keys(nuevo.body).sort(), Object.keys(existente.body).sort());
      assert.equal(nuevo.body.emailEnviado, existente.body.emailEnviado);
    }
  });

  it('el correo a una cuenta existente dice "inicia sesión" (existingAccount: true); a una nueva, "crea tu cuenta" (existingAccount: false)', async () => {
    const { deps: depsNuevo, sentEmails: emailsNuevo } = createDeps();
    await crearInvitacion(depsNuevo, ADMIN, { email: 'nunca-existio-2@club.cl' });
    assert.equal((emailsNuevo[0] as { existingAccount: boolean }).existingAccount, false);

    const { deps: depsExistente, sentEmails: emailsExistente } = createDeps({}, [
      { id: 'u3', organizationId: 'otro-club', email: 'con-cuenta@club.cl', name: 'Con Cuenta', rol: 'SOCIO', emailVerified: true },
    ]);
    await crearInvitacion(depsExistente, ADMIN, { email: 'con-cuenta@club.cl' });
    assert.equal((emailsExistente[0] as { existingAccount: boolean }).existingAccount, true);
  });

  it('revoca cualquier invitación pendiente previa para el mismo email', async () => {
    const { deps, invitaciones } = createDeps();
    const primera = await crearInvitacion(deps, ADMIN, { email: 'dup@club.cl' });
    assert.equal(primera.ok, true);
    const segunda = await crearInvitacion(deps, ADMIN, { email: 'dup@club.cl' });
    assert.equal(segunda.ok, true);

    assert.equal(invitaciones.length, 2);
    assert.notEqual(invitaciones[0]?.revocadaAt, null);
    assert.equal(invitaciones[1]?.revocadaAt, null);
  });

  it('rol por defecto es SOCIO', async () => {
    const { deps } = createDeps();
    const result = await crearInvitacion(deps, ADMIN, { email: 'sinrol@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.invitacion.rol, 'SOCIO');
  });

  it('un fallo de envío de correo no impide la creación (201, emailEnviado: false)', async () => {
    const { deps, invitaciones } = createDeps({
      sendEmail: async () => {
        throw new Error('SMTP down');
      },
    });
    const result = await crearInvitacion(deps, ADMIN, { email: 'sinmail@club.cl' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 201);
      assert.equal(result.body.emailEnviado, false);
    }
    assert.equal(invitaciones.length, 1);
  });

  it('crearInvitacion arma inviteUrl con el slug del club antes del fragmento', async () => {
    const { deps } = createDeps({ organizationSlug: 'el-montanista' });
    const result = await crearInvitacion(deps, ADMIN, { email: 'nueva@example.com' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.body.inviteUrl, /^https:\/\/andinoclubpamir\.app\/el-montanista\/#invite=/);
  });

  it('inviteUrl usa el fragmento /#invite= y el registro solo guarda el hash', async () => {
    const { deps, invitaciones } = createDeps();
    const result = await crearInvitacion(deps, ADMIN, { email: 'frag@club.cl' });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.match(result.body.inviteUrl, /^https:\/\/andinoclubpamir\.app\/club-test\/#invite=/);
    const token = result.body.inviteUrl.split('#invite=')[1] ?? '';
    assert.ok(token.length > 0);

    const stored = invitaciones[0];
    assert.ok(stored);
    // El token en claro nunca aparece en ningún campo persistido.
    for (const value of Object.values(stored as Record<string, unknown>)) {
      if (typeof value === 'string') {
        assert.equal(value.includes(token), false);
      }
    }
    assert.notEqual(stored?.tokenHash, token);
  });

  it('normaliza el email a minúsculas y sin espacios', async () => {
    const { deps, invitaciones } = createDeps();
    const result = await crearInvitacion(deps, ADMIN, { email: '  Mayus@Club.cl  ' });
    assert.equal(result.ok, true);
    assert.equal(invitaciones[0]?.email, 'mayus@club.cl');
  });

  it('la invitación creada guarda el organizationId de quien invita', async () => {
    const { deps, invitaciones } = createDeps();
    const result = await crearInvitacion(deps, ADMIN, { email: 'org@club.cl' });
    assert.equal(result.ok, true);
    assert.equal(invitaciones[0]?.organizationId, ADMIN.organizationId);
  });
});

// ─── listarInvitaciones ─────────────────────────────────────────────────────────

describe('listarInvitaciones', () => {
  it('ADMIN ve todas las invitaciones', async () => {
    const { deps } = createDeps();
    await crearInvitacion(deps, ADMIN, { email: 'a@club.cl' });
    await crearInvitacion(deps, LIDER, { email: 'b@club.cl' });

    const result = await listarInvitaciones(deps, ADMIN);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.invitaciones.length, 2);
  });

  it('LIDER solo ve las suyas', async () => {
    const { deps } = createDeps();
    await crearInvitacion(deps, ADMIN, { email: 'a@club.cl' });
    await crearInvitacion(deps, LIDER, { email: 'b@club.cl' });

    const result = await listarInvitaciones(deps, LIDER);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.body.invitaciones.length, 1);
      assert.equal(result.body.invitaciones[0]?.email, 'b@club.cl');
    }
  });

  it('un SOCIO no puede listar', async () => {
    const { deps } = createDeps();
    const result = await listarInvitaciones(deps, SOCIO);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });
});

// ─── revocarInvitacion ──────────────────────────────────────────────────────────

describe('revocarInvitacion', () => {
  it('ADMIN puede revocar la invitación de un LIDER', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, LIDER, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    const result = await revocarInvitacion(deps, ADMIN, creada.body.invitacion.id);
    assert.equal(result.ok, true);
  });

  it('LIDER no puede revocar la invitación de otro LIDER (404, no revela existencia)', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    const result = await revocarInvitacion(deps, LIDER, creada.body.invitacion.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it('LIDER puede revocar su propia invitación', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, LIDER, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    const result = await revocarInvitacion(deps, LIDER, creada.body.invitacion.id);
    assert.equal(result.ok, true);
  });

  it('devuelve 404 para un id inexistente', async () => {
    const { deps } = createDeps();
    const result = await revocarInvitacion(deps, ADMIN, 'no-existe');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it('devuelve 409 si ya no está pendiente', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    const primera = await revocarInvitacion(deps, ADMIN, creada.body.invitacion.id);
    assert.equal(primera.ok, true);

    const segunda = await revocarInvitacion(deps, ADMIN, creada.body.invitacion.id);
    assert.equal(segunda.ok, false);
    if (!segunda.ok) {
      assert.equal(segunda.status, 409);
      assert.equal(segunda.error, 'La invitación ya no está pendiente');
    }
  });
});

// ─── reenviarInvitacion ─────────────────────────────────────────────────────────

describe('reenviarInvitacion', () => {
  it('un email con cuenta en OTRO club ya no se rechaza al reenviar', async () => {
    const { deps, users, invitaciones } = createDeps({}, [
      { id: 'u4', organizationId: 'otro-club', email: 'reenvio-otro@club.cl', name: 'Reenvío', rol: 'SOCIO', emailVerified: true },
    ]);
    void users;
    const primera = await crearInvitacion(
      { ...deps, repo: { ...deps.repo, findAccountMembershipStatus: async () => ({ cuentaExiste: false, esSocioDeEsteClub: false }) } },
      ADMIN,
      { email: 'reenvio-otro@club.cl' },
    );
    assert.equal(primera.ok, true);
    if (!primera.ok) return;

    const reenviada = await reenviarInvitacion(deps, ADMIN, primera.body.invitacion.id);
    assert.equal(reenviada.ok, true);
    assert.equal(invitaciones.filter((i) => i.email === 'reenvio-otro@club.cl').length, 2);
  });

  it('la respuesta (status + body, salvo id/timestamps/token) es IDÉNTICA para un email sin cuenta y un email con cuenta en otro club (deferred finding de Task 2, Review Focus #2)', async () => {
    // Mismo email literal en ambos escenarios (cada uno con su propio
    // repositorio en memoria independiente) para poder comparar el body
    // completo por deepEqual sin tener que normalizar el campo email.
    const emailSimetria = 'reenvio-simetria@club.cl';

    const { deps: depsSinCuenta } = createDeps();
    const creadaSinCuenta = await crearInvitacion(depsSinCuenta, ADMIN, { email: emailSimetria });
    assert.equal(creadaSinCuenta.ok, true);
    if (!creadaSinCuenta.ok) return;

    const { deps: depsOtroClub } = createDeps({}, [
      { id: 'u-reenvio-simetria', organizationId: 'otro-club', email: emailSimetria, name: 'Otro', rol: 'SOCIO', emailVerified: true },
    ]);
    const creadaOtroClub = await crearInvitacion(depsOtroClub, ADMIN, { email: emailSimetria });
    assert.equal(creadaOtroClub.ok, true);
    if (!creadaOtroClub.ok) return;

    const reenviadaSinCuenta = await reenviarInvitacion(depsSinCuenta, ADMIN, creadaSinCuenta.body.invitacion.id);
    const reenviadaOtroClub = await reenviarInvitacion(depsOtroClub, ADMIN, creadaOtroClub.body.invitacion.id);

    assert.equal(reenviadaSinCuenta.ok, reenviadaOtroClub.ok);
    if (!reenviadaSinCuenta.ok || !reenviadaOtroClub.ok) return;
    assert.equal(reenviadaSinCuenta.status, reenviadaOtroClub.status);
    assert.deepEqual(
      normalizarCrearInvitacionBody(reenviadaSinCuenta.body),
      normalizarCrearInvitacionBody(reenviadaOtroClub.body),
    );
  });

  it('reenvía una invitación pendiente con un token nuevo', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    const result = await reenviarInvitacion(deps, ADMIN, creada.body.invitacion.id);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.notEqual(result.body.inviteUrl, creada.body.inviteUrl);
      assert.match(result.body.inviteUrl, /^https:\/\/andinoclubpamir\.app\/club-test\/#invite=/);
    }
  });

  it('el reenvío conserva el organizationId de la invitación', async () => {
    const { deps, invitaciones } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    const result = await reenviarInvitacion(deps, ADMIN, creada.body.invitacion.id);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const nueva = invitaciones.find((i) => i.id === result.body.invitacion.id);
    assert.equal(nueva?.organizationId, ADMIN.organizationId);
  });

  it('reenvía una invitación expirada', async () => {
    const { deps } = createDeps({ now: () => new Date('2026-02-01T00:00:00.000Z') });
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    // Avanza el reloj más allá del TTL de 7 días.
    const depsFuturo: InvitacionesDeps = { ...deps, now: () => new Date('2026-02-10T00:00:00.000Z') };
    const result = await reenviarInvitacion(depsFuturo, ADMIN, creada.body.invitacion.id);
    assert.equal(result.ok, true);
  });

  it('LIDER no puede reenviar la invitación de otro LIDER', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    const otroLider = { id: 'lider-2', organizationId: 'org-1', name: 'Otro Lider', rol: 'LIDER' as RolUsuario };
    const result = await reenviarInvitacion(deps, otroLider, creada.body.invitacion.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it('devuelve 409 si ya fue aceptada', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const aceptada = await aceptarInvitacion(deps, token, { name: 'Nuevo', password: 'password123' }, { verifiedEmail: null });
    assert.equal(aceptada.ok, true);

    const result = await reenviarInvitacion(deps, ADMIN, creada.body.invitacion.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });
});

// ─── consultarInvitacion ────────────────────────────────────────────────────────

describe('consultarInvitacion', () => {
  it('token desconocido devuelve 404', async () => {
    const { deps } = createDeps();
    const result = await consultarInvitacion(deps, 'token-inexistente');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 404);
      assert.equal(result.error, 'La invitación no es válida');
    }
  });

  it('invitación pendiente y vigente devuelve 200 con los datos', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl', rol: 'LIDER' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await consultarInvitacion(deps, token);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.body.email, 'x@club.cl');
      assert.equal(result.body.rol, 'LIDER');
      assert.equal(result.body.rolLabel, 'Líder');
      assert.equal(result.body.invitadoPor, 'Ada Admin');
      assert.equal(result.body.organization, null);
      assert.equal(result.body.cuentaExistente, false);
    }
  });

  it('consultarInvitacion informa cuentaExistente:true cuando el email invitado ya tiene cuenta', async () => {
    const { deps } = createDeps({}, [
      { id: 'existente-consulta', organizationId: 'otro-club', email: 'existente@example.com', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const creada = await crearInvitacion(deps, ADMIN, { email: 'existente@example.com' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = extractTokenFromInviteUrl(creada.body.inviteUrl);

    const result = await consultarInvitacion(deps, token);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.cuentaExistente, true);
  });

  it('consultarInvitacion informa cuentaExistente:false cuando el email invitado no tiene cuenta', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'sin-cuenta@example.com' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = extractTokenFromInviteUrl(creada.body.inviteUrl);

    const result = await consultarInvitacion(deps, token);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.cuentaExistente, false);
  });

  it('incluye la marca del club cuando deps expone getOrganizationBrand', async () => {
    const { deps } = createDeps({
      getOrganizationBrand: async () => ({
        slug: 'pamir',
        name: 'Andino Club Pamir',
        shortName: 'Pamir',
      }),
    });
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await consultarInvitacion(deps, token);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.body.organization, {
        slug: 'pamir',
        name: 'Andino Club Pamir',
        shortName: 'Pamir',
      });
    }
  });

  it('invitación ya aceptada devuelve 410', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';
    await aceptarInvitacion(deps, token, { name: 'Nuevo', password: 'password123' }, { verifiedEmail: null });

    const result = await consultarInvitacion(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 410);
      assert.equal(result.error, 'Esta invitación ya fue utilizada. Inicia sesión.');
    }
  });

  it('invitación revocada devuelve 410', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    await revocarInvitacion(deps, ADMIN, creada.body.invitacion.id);
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await consultarInvitacion(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 410);
      assert.equal(result.error, 'La invitación ya no está vigente');
    }
  });

  it('invitación expirada devuelve 410', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const depsFuturo: InvitacionesDeps = { ...deps, now: () => new Date('2026-02-01T00:00:00.000Z') };
    const result = await consultarInvitacion(depsFuturo, token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 410);
      assert.equal(result.error, 'La invitación expiró. Pide a quien te invitó que la reenvíe.');
    }
  });

  it('se rechaza (410) cuando quien invitó ya no existe', async () => {
    const { deps, users } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    // Simula que el admin invitador fue eliminado.
    users.splice(users.findIndex((u) => u.id === ADMIN.id), 1);

    const result = await consultarInvitacion(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 410);
      assert.equal(result.error, 'La invitación ya no está vigente');
    }
  });

  it('se rechaza (410) cuando quien invitó fue degradado y ya no puede otorgar ese rol', async () => {
    const { deps, users } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl', rol: 'LIDER' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    // El admin invitador es degradado a SOCIO: ya no puede otorgar LIDER.
    const admin = users.find((u) => u.id === ADMIN.id);
    if (admin) admin.rol = 'SOCIO';

    const result = await consultarInvitacion(deps, token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 410);
  });
});

// ─── aceptarInvitacion ──────────────────────────────────────────────────────────

describe('aceptarInvitacion', () => {
  it('crea la cuenta con el email y rol de la invitación (happy path)', async () => {
    const { deps, users } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'nueva@club.cl', rol: 'LIDER' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await aceptarInvitacion(deps, token, { name: 'Nueva Persona', password: 'password123' }, { verifiedEmail: null });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 201);
      assert.equal(result.body.email, 'nueva@club.cl');
      assert.equal(result.body.message, 'Cuenta creada. Ya puedes iniciar sesión.');
    }

    const creado = users.find((u) => u.email === 'nueva@club.cl');
    assert.ok(creado);
    assert.equal(creado?.rol, 'LIDER');
    assert.equal(creado?.emailVerified, true);
  });

  it('ignora email y rol si vienen en el body', async () => {
    const { deps, users } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'real@club.cl', rol: 'SOCIO' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await aceptarInvitacion(deps, token, {
      name: 'Nombre Real',
      password: 'password123',
      // Estos dos campos no forman parte del contrato de entrada y deben ignorarse.
      email: 'otro@evil.cl',
      rol: 'ADMIN',
    } as unknown as { name: unknown; password: unknown }, { verifiedEmail: null });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.email, 'real@club.cl');

    assert.equal(users.some((u) => u.email === 'otro@evil.cl'), false);
    const creado = users.find((u) => u.email === 'real@club.cl');
    assert.equal(creado?.rol, 'SOCIO');
  });

  it('el usuario aceptado hereda el organizationId de la invitación aunque el body envíe otro', async () => {
    const { deps, users } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'club@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await aceptarInvitacion(deps, token, {
      name: 'Alguien',
      password: 'password123',
      // No forma parte del contrato de entrada: debe ignorarse igual que email/rol.
      organizationId: 'org-intrusa',
    } as unknown as { name: unknown; password: unknown }, { verifiedEmail: null });
    assert.equal(result.ok, true);

    const creado = users.find((u) => u.email === 'club@club.cl');
    assert.equal(creado?.organizationId, ADMIN.organizationId);
  });

  it('un segundo intento de aceptación falla', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const primero = await aceptarInvitacion(deps, token, { name: 'Uno', password: 'password123' }, { verifiedEmail: null });
    assert.equal(primero.ok, true);

    const segundo = await aceptarInvitacion(deps, token, { name: 'Dos', password: 'password123' }, { verifiedEmail: null });
    assert.equal(segundo.ok, false);
    if (!segundo.ok) {
      assert.equal(segundo.status, 410);
      assert.equal(segundo.error, 'Esta invitación ya fue utilizada. Inicia sesión.');
    }
  });

  it('rechaza una contraseña débil con el mensaje compartido', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await aceptarInvitacion(deps, token, { name: 'Alguien', password: '123' }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, 'Mínimo 8 caracteres');
    }
  });

  it('rechaza un nombre vacío con el mensaje compartido', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await aceptarInvitacion(deps, token, { name: '', password: 'password123' }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, 'El nombre es requerido');
    }
  });

  it('si una cuenta con ese email se crea en el medio de la carrera, ya no se rechaza con 409: entra por la rama de cuenta existente (y ahí, contraseña equivocada => 401, ninguna cuenta nueva)', async () => {
    const { deps, users } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const usersAntes = users.length;
    users.push({ id: 'raced', organizationId: 'org-1', email: 'x@club.cl', name: 'Otro', rol: 'SOCIO', emailVerified: true });

    // El fake's findAccountForOwnershipProof modela el passwordHash real de
    // 'raced' como `hashed:x@club.cl-password` (ver createFakeRepo) — la
    // contraseña enviada acá ('password123') no calza, así que la prueba de
    // titularidad falla exactamente como si alguien más estuviera probando
    // suerte con la cuenta ajena.
    const result = await aceptarInvitacion(deps, token, { name: 'Alguien', password: 'password123' }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
      assert.equal(result.error, 'Ya tienes una cuenta con este correo. Verifica tu contraseña e inténtalo de nuevo.');
    }
    // Ninguna cuenta nueva se creó: solo sigue estando 'raced', empujada a
    // propósito arriba.
    assert.equal(users.length, usersAntes + 1);
  });

  it('ignora un emitidaPorPlataforma/organizationId inyectados en el body: la cuenta hereda los de la invitación', async () => {
    const { deps, users, invitaciones } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'segura@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const result = await aceptarInvitacion(deps, token, {
      name: 'Alguien',
      password: 'password123',
      // No forman parte del contrato de entrada de aceptarInvitacion: deben ignorarse.
      emitidaPorPlataforma: true,
      organizationId: 'org-intrusa',
    } as unknown as { name: unknown; password: unknown }, { verifiedEmail: null });
    assert.equal(result.ok, true);

    const creado = users.find((u) => u.email === 'segura@club.cl');
    assert.equal(creado?.organizationId, ADMIN.organizationId);
    assert.equal(invitaciones.find((i) => i.email === 'segura@club.cl')?.emitidaPorPlataforma, false);
  });
});

// ─── aceptarInvitacion — cuenta existente (PR "Joining") ──────────────────────

describe('aceptarInvitacion — cuenta existente (PR "Joining")', () => {
  it('con la contraseña correcta, crea SOLO la Membresia (nunca un User nuevo, nunca toca el nombre)', async () => {
    const { deps, users } = createDeps({}, [
      { id: 'existente-1', organizationId: 'otro-club', email: 'existe@club.cl', name: 'Nombre Original', rol: 'SOCIO', emailVerified: true },
    ]);
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe@club.cl', rol: 'LIDER' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const usersAntes = users.length;
    const result = await aceptarInvitacion(
      deps,
      token,
      { name: 'Nombre Que Se Ignora', password: 'existe@club.cl-password' },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.email, 'existe@club.cl');
    // El fake modela "cuenta existente" en el array `users`; ningún User
    // nuevo se agrega (createFakeRepo.acceptInvitacionExistente, ver más
    // abajo, no empuja a `users`).
    assert.equal(users.length, usersAntes);
  });

  it('con un rol/organizationId/email en conflicto en el body, la Membresia usa los de la INVITACIÓN (nunca los del body) y no toca el perfil', async () => {
    const { deps, users, membresias } = createDeps({}, [
      { id: 'existente-5', organizationId: 'otro-club', email: 'existe5@club.cl', name: 'Nombre Original', rol: 'SOCIO', emailVerified: true },
    ]);
    // La invitación otorga LIDER en el club de ADMIN — el body de abajo
    // intentará "colarse" con otro rol, otro club y hasta otro email.
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe5@club.cl', rol: 'LIDER' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const usersAntes = users.length;
    const result = await aceptarInvitacion(
      deps,
      token,
      {
        name: 'Nombre Que Se Ignora',
        password: 'existe5@club.cl-password',
        // Ninguno de estos tres forma parte del contrato de entrada de la
        // rama de cuenta existente: deben ignorarse igual que en el flujo
        // de cuenta nueva (ver 'ignora un emitidaPorPlataforma/...' arriba).
        rol: 'ADMIN',
        organizationId: 'org-intrusa',
        email: 'otro@evil.cl',
      } as unknown as { name: unknown; password: unknown },
      { verifiedEmail: null },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.email, 'existe5@club.cl');

    // Ninguna cuenta nueva se creó y el perfil compartido de la cuenta
    // existente no se tocó.
    assert.equal(users.length, usersAntes);
    const cuenta = users.find((u) => u.id === 'existente-5');
    assert.equal(cuenta?.name, 'Nombre Original');
    assert.equal(cuenta?.organizationId, 'otro-club');

    // Se creó EXACTAMENTE una Membresia — para la cuenta cuyo email es el de
    // la INVITACIÓN (no 'otro@evil.cl' del body), con el rol y el club de
    // la INVITACIÓN (LIDER, ADMIN.organizationId), nunca los del body
    // ('ADMIN', 'org-intrusa').
    assert.equal(membresias.length, 1);
    assert.equal(membresias[0]?.usuarioId, 'existente-5');
    assert.equal(membresias[0]?.rol, 'LIDER');
    assert.equal(membresias[0]?.organizationId, ADMIN.organizationId);
  });

  it('con la contraseña incorrecta, responde 401 y no crea nada', async () => {
    const { deps, invitaciones } = createDeps({}, [
      { id: 'existente-2', organizationId: 'otro-club', email: 'existe2@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe2@club.cl' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const result = await aceptarInvitacion(deps, token, { name: 'X', password: 'contraseña-incorrecta' }, { verifiedEmail: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    const invitacion = invitaciones.find((i) => i.id === crear.body.invitacion.id);
    assert.equal(invitacion?.aceptadaAt, null);
  });

  it('con un Bearer del MISMO email (sin password), crea la Membresia igual', async () => {
    const { deps, users } = createDeps({}, [
      { id: 'existente-3', organizationId: 'otro-club', email: 'existe3@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe3@club.cl' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const usersAntes = users.length;
    const result = await aceptarInvitacion(deps, token, { name: undefined, password: undefined }, { verifiedEmail: 'existe3@club.cl' });
    assert.equal(result.ok, true);
    // Igual que la rama por contraseña: ningún User nuevo se crea (ver
    // createFakeRepo.acceptInvitacionExistente, que nunca empuja a `users`).
    assert.equal(users.length, usersAntes);
  });

  it('con un Bearer de OTRO email, responde 403 "Esta invitación es para otro correo"', async () => {
    const { deps } = createDeps({}, [
      { id: 'existente-4', organizationId: 'otro-club', email: 'existe4@club.cl', name: 'X', rol: 'SOCIO', emailVerified: true },
    ]);
    const crear = await crearInvitacion(deps, ADMIN, { email: 'existe4@club.cl' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const result = await aceptarInvitacion(deps, token, {}, { verifiedEmail: 'alguien-mas@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error, 'Esta invitación es para otro correo');
    }
  });

  it('sin cuenta existente, el comportamiento de siempre no cambia (regresión)', async () => {
    const { deps } = createDeps();
    const crear = await crearInvitacion(deps, ADMIN, { email: 'nunca-existio-3@club.cl' });
    assert.equal(crear.ok, true);
    if (!crear.ok) return;
    const token = extractTokenFromInviteUrl(crear.body.inviteUrl);

    const result = await aceptarInvitacion(deps, token, { name: 'Nuevo', password: 'password123' }, { verifiedEmail: null });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.message, 'Cuenta creada. Ya puedes iniciar sesión.');
  });
});

// ─── crearInvitacionPlataforma ──────────────────────────────────────────────────

describe('crearInvitacionPlataforma', () => {
  it('crea una invitación sin invitador para el club indicado (happy path)', async () => {
    const { deps, invitaciones } = createDeps();
    const result = await crearInvitacionPlataforma(deps, {
      organizationId: 'org-nuevo',
      email: 'primer-admin@club-nuevo.cl',
      rol: 'ADMIN',
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, 201);
      assert.equal(result.body.invitacion.invitadoPor, null);
      assert.equal(result.body.invitacion.emitidaPorPlataforma, true);
      assert.equal(result.body.invitacion.rol, 'ADMIN');
      assert.equal(result.body.emailEnviado, true);
      assert.match(result.body.inviteUrl, /^https:\/\/andinoclubpamir\.app\/club-test\/#invite=/);
    }

    const guardada = invitaciones.find((i) => i.email === 'primer-admin@club-nuevo.cl');
    assert.equal(guardada?.organizationId, 'org-nuevo');
    assert.equal(guardada?.invitadoPorId, null);
    assert.equal(guardada?.emitidaPorPlataforma, true);
  });

  it('usa "el equipo de la plataforma" como nombre del invitador en el correo', async () => {
    const { deps, sentEmails } = createDeps();
    await crearInvitacionPlataforma(deps, { organizationId: 'org-nuevo', email: 'x@club-nuevo.cl', rol: 'ADMIN' });
    assert.equal((sentEmails[0] as { invitadoPorNombre: string }).invitadoPorNombre, 'el equipo de la plataforma');
  });

  it('rechaza con 409 "Ya es socio de este club" si la cuenta ya es socia del club destino (Ruling 7)', async () => {
    const { deps } = createDeps({}, [
      { id: 'u1', organizationId: 'org-nuevo', email: 'ya@club.cl', name: 'Ya', rol: 'SOCIO', emailVerified: true },
    ]);
    const result = await crearInvitacionPlataforma(deps, { organizationId: 'org-nuevo', email: 'ya@club.cl', rol: 'ADMIN' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, 'Ya es socio de este club');
    }
  });

  it('un email con cuenta en OTRO club ya no se rechaza (Ruling 7: no hay enumeración que proteger frente a un CLI de confianza)', async () => {
    const { deps } = createDeps({}, [
      { id: 'u1', organizationId: 'org-1', email: 'otro-club@club.cl', name: 'Ya', rol: 'SOCIO', emailVerified: true },
    ]);
    const result = await crearInvitacionPlataforma(deps, {
      organizationId: 'org-nuevo',
      email: 'otro-club@club.cl',
      rol: 'ADMIN',
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.status, 201);
  });

  it('la respuesta (status + body, salvo id/timestamps/token) es IDÉNTICA para un email sin cuenta y un email con cuenta en otro club (deferred finding de Task 2)', async () => {
    // Mismo email literal en ambos escenarios (cada uno con su propio
    // repositorio en memoria independiente) para poder comparar el body
    // completo por deepEqual sin tener que normalizar el campo email.
    const emailSimetria = 'plataforma-simetria@club.cl';

    const { deps: depsSinCuenta } = createDeps();
    const sinCuenta = await crearInvitacionPlataforma(depsSinCuenta, {
      organizationId: 'org-nuevo-simetria',
      email: emailSimetria,
      rol: 'ADMIN',
    });

    const { deps: depsOtroClub } = createDeps({}, [
      { id: 'u-plataforma-simetria', organizationId: 'otro-club', email: emailSimetria, name: 'Otro', rol: 'SOCIO', emailVerified: true },
    ]);
    const otroClub = await crearInvitacionPlataforma(depsOtroClub, {
      organizationId: 'org-nuevo-simetria',
      email: emailSimetria,
      rol: 'ADMIN',
    });

    assert.equal(sinCuenta.ok, otroClub.ok);
    if (!sinCuenta.ok || !otroClub.ok) return;
    assert.equal(sinCuenta.status, otroClub.status);
    assert.deepEqual(
      normalizarCrearInvitacionBody(sinCuenta.body),
      normalizarCrearInvitacionBody(otroClub.body),
    );
  });

  it('rechaza un rol desconocido', async () => {
    const { deps } = createDeps();
    const result = await crearInvitacionPlataforma(deps, { organizationId: 'org-nuevo', email: 'x@club-nuevo.cl', rol: 'SUPERADMIN' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it('rechaza un email inválido', async () => {
    const { deps } = createDeps();
    const result = await crearInvitacionPlataforma(deps, { organizationId: 'org-nuevo', email: 'no-es-un-email', rol: 'ADMIN' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });

  it('revoca cualquier invitación pendiente previa para el mismo email', async () => {
    const { deps, invitaciones } = createDeps();
    await crearInvitacionPlataforma(deps, { organizationId: 'org-nuevo', email: 'dup@club-nuevo.cl', rol: 'ADMIN' });
    await crearInvitacionPlataforma(deps, { organizationId: 'org-nuevo', email: 'dup@club-nuevo.cl', rol: 'ADMIN' });

    assert.equal(invitaciones.length, 2);
    assert.notEqual(invitaciones[0]?.revocadaAt, null);
    assert.equal(invitaciones[1]?.revocadaAt, null);
  });

  describe('exención de la regla de autoridad vigente', () => {
    it('consultarInvitacion es válida y devuelve la etiqueta de la plataforma, sin invitador', async () => {
      const { deps } = createDeps();
      const creada = await crearInvitacionPlataforma(deps, { organizationId: 'org-nuevo', email: 'x@club-nuevo.cl', rol: 'ADMIN' });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;
      const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

      const result = await consultarInvitacion(deps, token);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.body.invitadoPor, 'el equipo de la plataforma');
        assert.equal(result.body.rol, 'ADMIN');
      }
    });

    it('aceptarInvitacion crea un ADMIN del club indicado, sin depender de ningún invitador', async () => {
      const { deps, users } = createDeps();
      const creada = await crearInvitacionPlataforma(deps, { organizationId: 'org-nuevo', email: 'nuevo-admin@club-nuevo.cl', rol: 'ADMIN' });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;
      const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

      const result = await aceptarInvitacion(deps, token, { name: 'Nuevo Admin', password: 'password123' }, { verifiedEmail: null });
      assert.equal(result.ok, true);

      const creado = users.find((u) => u.email === 'nuevo-admin@club-nuevo.cl');
      assert.equal(creado?.rol, 'ADMIN');
      assert.equal(creado?.organizationId, 'org-nuevo');
    });

    it('en cambio, una invitación NORMAL sigue rechazándose si su invitador ya no existe', async () => {
      const { deps, users } = createDeps();
      const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;
      const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

      users.splice(users.findIndex((u) => u.id === ADMIN.id), 1);

      const result = await consultarInvitacion(deps, token);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 410);
    });
  });

  describe('gestión por el ADMIN/LIDER del club', () => {
    it('un ADMIN puede reenviarla; el reenvío produce una invitación normal emitida por ese ADMIN', async () => {
      const { deps, invitaciones } = createDeps();
      const creada = await crearInvitacionPlataforma(deps, {
        organizationId: ADMIN.organizationId,
        email: 'reenviar@club.cl',
        rol: 'SOCIO',
      });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;

      const result = await reenviarInvitacion(deps, ADMIN, creada.body.invitacion.id);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.body.invitacion.emitidaPorPlataforma, false);
      assert.equal(result.body.invitacion.invitadoPor?.id, ADMIN.id);
      const nueva = invitaciones.find((i) => i.id === result.body.invitacion.id);
      assert.equal(nueva?.invitadoPorId, ADMIN.id);
    });

    it('un ADMIN puede revocarla', async () => {
      const { deps } = createDeps();
      const creada = await crearInvitacionPlataforma(deps, {
        organizationId: ADMIN.organizationId,
        email: 'revocar@club.cl',
        rol: 'SOCIO',
      });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;

      const result = await revocarInvitacion(deps, ADMIN, creada.body.invitacion.id);
      assert.equal(result.ok, true);
    });

    it('un LIDER no la ve al listar (solo ve las suyas) ni puede gestionarla (404)', async () => {
      const { deps } = createDeps();
      const creada = await crearInvitacionPlataforma(deps, {
        organizationId: ADMIN.organizationId,
        email: 'oculta-para-lider@club.cl',
        rol: 'SOCIO',
      });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;

      const listado = await listarInvitaciones(deps, LIDER);
      assert.equal(listado.ok, true);
      if (listado.ok) {
        assert.equal(listado.body.invitaciones.some((i) => i.id === creada.body.invitacion.id), false);
      }

      const revocar = await revocarInvitacion(deps, LIDER, creada.body.invitacion.id);
      assert.equal(revocar.ok, false);
      if (!revocar.ok) assert.equal(revocar.status, 404);

      const reenviar = await reenviarInvitacion(deps, LIDER, creada.body.invitacion.id);
      assert.equal(reenviar.ok, false);
      if (!reenviar.ok) assert.equal(reenviar.status, 404);
    });

    it('un ADMIN sí la ve al listar', async () => {
      const { deps } = createDeps();
      const creada = await crearInvitacionPlataforma(deps, {
        organizationId: ADMIN.organizationId,
        email: 'visible-para-admin@club.cl',
        rol: 'SOCIO',
      });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;

      const listado = await listarInvitaciones(deps, ADMIN);
      assert.equal(listado.ok, true);
      if (listado.ok) {
        const encontrada = listado.body.invitaciones.find((i) => i.id === creada.body.invitacion.id);
        assert.ok(encontrada);
        assert.equal(encontrada?.emitidaPorPlataforma, true);
      }
    });
  });
});
