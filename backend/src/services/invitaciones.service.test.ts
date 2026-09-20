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
  type InvitacionesDeps,
  type InvitacionesRepo,
  type InvitacionRow,
} from './invitaciones.service.js';

// ─── Fake repo (en memoria, sin Prisma) ────────────────────────────────────────

interface FakeUser {
  id: string;
  email: string;
  name: string;
  rol: RolUsuario;
  emailVerified: boolean;
}

function createFakeRepo(seedUsers: FakeUser[] = []): {
  repo: InvitacionesRepo;
  users: FakeUser[];
  invitaciones: InvitacionRow[];
} {
  const users = [...seedUsers];
  const invitaciones: InvitacionRow[] = [];
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${++seq}`;

  const repo: InvitacionesRepo = {
    async findUserByEmail(email) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id, email: u.email, name: u.name, rol: u.rol } : null;
    },
    async findUserById(id) {
      const u = users.find((x) => x.id === id);
      return u ? { id: u.id, name: u.name, rol: u.rol } : null;
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
        email: data.email,
        rol: data.rol,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        invitadoPorId: data.invitadoPorId,
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
    async acceptInvitacion({ invitacionId, email, name, passwordHash, rol, now }) {
      void passwordHash;
      const inv = invitaciones.find((i) => i.id === invitacionId);
      if (!inv || inv.aceptadaAt !== null || inv.revocadaAt !== null || inv.expiresAt <= now) {
        return null;
      }
      inv.aceptadaAt = now;
      const user: FakeUser = { id: nextId('user'), email, name, rol, emailVerified: true };
      users.push(user);
      inv.usuarioId = user.id;
      return { id: user.id, email: user.email, name: user.name, rol: user.rol };
    },
  };

  return { repo, users, invitaciones };
}

// Todo Requester usado como invitador debe existir como fila de usuario en el
// repositorio: verificarVigencia comprueba la autoridad ACTUAL de quien invitó
// (findUserById), no la que tenía en el momento de invitar.
function createDeps(overrides: Partial<InvitacionesDeps> = {}, extraUsers: FakeUser[] = []) {
  const seedUsers: FakeUser[] = [
    { id: ADMIN.id, email: 'admin@club.cl', name: ADMIN.name, rol: 'ADMIN', emailVerified: true },
    { id: LIDER.id, email: 'lider@club.cl', name: LIDER.name, rol: 'LIDER', emailVerified: true },
    { id: SOCIO.id, email: 'socio@club.cl', name: SOCIO.name, rol: 'SOCIO', emailVerified: true },
    ...extraUsers,
  ];
  const { repo, users, invitaciones } = createFakeRepo(seedUsers);
  const sentEmails: unknown[] = [];
  const deps: InvitacionesDeps = {
    repo,
    sendEmail: async (params) => {
      sentEmails.push(params);
    },
    hashPassword: async (password) => `hashed:${password}`,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    frontendUrl: 'https://andinoclubpamir.app',
    ...overrides,
  };
  return { deps, users, invitaciones, sentEmails };
}

const ADMIN = { id: 'admin-1', name: 'Ada Admin', rol: 'ADMIN' as RolUsuario };
const LIDER = { id: 'lider-1', name: 'Leo Lider', rol: 'LIDER' as RolUsuario };
const SOCIO = { id: 'socio-1', name: 'Sam Socio', rol: 'SOCIO' as RolUsuario };

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

  it('rechaza con 409 si ya existe una cuenta con ese email', async () => {
    const { deps } = createDeps({}, [{ id: 'u1', email: 'ya@club.cl', name: 'Ya', rol: 'SOCIO', emailVerified: true }]);
    const result = await crearInvitacion(deps, ADMIN, { email: 'ya@club.cl' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, 'Ya existe una cuenta con ese correo');
    }
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

  it('inviteUrl usa el fragmento /#invite= y el registro solo guarda el hash', async () => {
    const { deps, invitaciones } = createDeps();
    const result = await crearInvitacion(deps, ADMIN, { email: 'frag@club.cl' });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.match(result.body.inviteUrl, /^https:\/\/andinoclubpamir\.app\/#invite=/);
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
  it('reenvía una invitación pendiente con un token nuevo', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;

    const result = await reenviarInvitacion(deps, ADMIN, creada.body.invitacion.id);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.notEqual(result.body.inviteUrl, creada.body.inviteUrl);
    }
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

    const otroLider = { id: 'lider-2', name: 'Otro Lider', rol: 'LIDER' as RolUsuario };
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

    const aceptada = await aceptarInvitacion(deps, token, { name: 'Nuevo', password: 'password123' });
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
    }
  });

  it('invitación ya aceptada devuelve 410', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';
    await aceptarInvitacion(deps, token, { name: 'Nuevo', password: 'password123' });

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

    const result = await aceptarInvitacion(deps, token, { name: 'Nueva Persona', password: 'password123' });
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
    } as unknown as { name: unknown; password: unknown });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.body.email, 'real@club.cl');

    assert.equal(users.some((u) => u.email === 'otro@evil.cl'), false);
    const creado = users.find((u) => u.email === 'real@club.cl');
    assert.equal(creado?.rol, 'SOCIO');
  });

  it('un segundo intento de aceptación falla', async () => {
    const { deps } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    const primero = await aceptarInvitacion(deps, token, { name: 'Uno', password: 'password123' });
    assert.equal(primero.ok, true);

    const segundo = await aceptarInvitacion(deps, token, { name: 'Dos', password: 'password123' });
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

    const result = await aceptarInvitacion(deps, token, { name: 'Alguien', password: '123' });
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

    const result = await aceptarInvitacion(deps, token, { name: '', password: 'password123' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, 'El nombre es requerido');
    }
  });

  it('rechaza si ya existe una cuenta con ese email (carrera perdida)', async () => {
    const { deps, users } = createDeps();
    const creada = await crearInvitacion(deps, ADMIN, { email: 'x@club.cl' });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    const token = creada.body.inviteUrl.split('#invite=')[1] ?? '';

    users.push({ id: 'raced', email: 'x@club.cl', name: 'Otro', rol: 'SOCIO', emailVerified: true });

    const result = await aceptarInvitacion(deps, token, { name: 'Alguien', password: 'password123' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });
});
