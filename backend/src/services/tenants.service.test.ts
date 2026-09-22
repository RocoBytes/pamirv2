import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OrganizationStatus } from '../generated/prisma/client.js';
import type { ServiceResult, CrearInvitacionBody, InvitacionPublica } from './invitaciones.service.js';
import {
  crearClub,
  listarClubes,
  cambiarEstadoClub,
  invitarAdminClub,
  actualizarClub,
  type TenantsDeps,
  type TenantsRepo,
  type OrganizationRow,
  type ClubListRow,
  type CrearClubInput,
  type ActualizarClubInput,
} from './tenants.service.js';

// ─── Fake repo (en memoria, sin Prisma) ────────────────────────────────────────

function createFakeRepo(seed: OrganizationRow[] = []): {
  repo: TenantsRepo;
  organizations: OrganizationRow[];
  setFailTransaccion: (fail: boolean) => void;
  updateOrganizationCallCount: () => number;
} {
  const organizations = [...seed];
  let seq = 0;
  const nextId = (): string => `org-${++seq}`;
  let failTransaccion = false;
  let updateOrganizationCalls = 0;

  const repo: TenantsRepo = {
    async findOrganizationBySlug(slug) {
      return organizations.find((o) => o.slug === slug) ?? null;
    },
    async findOrganizationByMembresia(membresiaPropia) {
      return organizations.find((o) => o.membresiaPropia === membresiaPropia) ?? null;
    },
    async crearClubTransaccion(data, categorias, declaracion) {
      void declaracion;
      // Simula una transacción real: si algo "falla a mitad de camino", no
      // debe quedar ningún rastro — ni la fila de Organization ni nada más.
      if (failTransaccion) {
        throw new Error('fallo simulado a mitad de la transacción');
      }
      const organization: OrganizationRow = {
        id: nextId(),
        slug: data.slug,
        name: data.name,
        shortName: data.shortName,
        status: 'ACTIVE',
        membresiaPropia: data.membresiaPropia,
        alertEmail: data.alertEmail,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      organizations.push(organization);
      return { organization, categoriasCreadas: categorias.length };
    },
    async listOrganizations(): Promise<ClubListRow[]> {
      return organizations.map((o) => ({
        slug: o.slug,
        name: o.name,
        status: o.status,
        membresiaPropia: o.membresiaPropia,
        userCount: 0,
        pendingInvitationCount: 0,
        createdAt: o.createdAt,
      }));
    },
    async updateOrganizationStatus(id, status) {
      const index = organizations.findIndex((o) => o.id === id);
      if (index === -1) throw new Error(`org "${id}" no existe en el fake repo`);
      // Reemplaza el elemento por un objeto NUEVO en vez de mutar el existente
      // in place: el repositorio real (Prisma) siempre devuelve una fila
      // recién leída en cada consulta, así que una referencia capturada ANTES
      // de este update (como el `organization` de findOrganizationBySlug en
      // cambiarEstadoClub) nunca debe verse afectada por él.
      const actualizado: OrganizationRow = { ...organizations[index]!, status };
      organizations[index] = actualizado;
      return actualizado;
    },
    async updateOrganization(id, data) {
      updateOrganizationCalls += 1;
      const index = organizations.findIndex((o) => o.id === id);
      if (index === -1) throw new Error(`org "${id}" no existe en el fake repo`);
      // Mismo motivo que en updateOrganizationStatus: objeto nuevo, nunca
      // mutación in place.
      const actualizado: OrganizationRow = { ...organizations[index]!, ...data };
      organizations[index] = actualizado;
      return actualizado;
    },
  };

  return {
    repo,
    organizations,
    setFailTransaccion: (fail: boolean) => (failTransaccion = fail),
    updateOrganizationCallCount: () => updateOrganizationCalls,
  };
}

function fakeInvitacionPublica(email: string): InvitacionPublica {
  return {
    id: 'fake-invitacion',
    email,
    rol: 'ADMIN',
    estado: 'PENDIENTE',
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    aceptadaAt: null,
    revocadaAt: null,
    invitadoPor: null,
    emitidaPorPlataforma: true,
  };
}

function createDeps(
  overrides: Partial<TenantsDeps> = {},
  seed: OrganizationRow[] = [],
): {
  deps: TenantsDeps;
  organizations: OrganizationRow[];
  invitacionCalls: { organizationId: string; email: string }[];
  setFailTransaccion: (fail: boolean) => void;
  setInvitacionFalla: (falla: boolean) => void;
  updateOrganizationCallCount: () => number;
} {
  const { repo, organizations, setFailTransaccion, updateOrganizationCallCount } = createFakeRepo(seed);
  const invitacionCalls: { organizationId: string; email: string }[] = [];
  let invitacionFalla = false;

  const crearInvitacionAdmin = async (
    organizationId: string,
    email: string,
  ): Promise<ServiceResult<CrearInvitacionBody>> => {
    invitacionCalls.push({ organizationId, email });
    if (invitacionFalla) {
      return { ok: false, status: 502, error: 'fallo simulado al emitir la invitación' };
    }
    return {
      ok: true,
      status: 201,
      body: {
        invitacion: fakeInvitacionPublica(email),
        inviteUrl: `https://club.test/#invite=token-${email}`,
        emailEnviado: true,
      },
    };
  };

  const deps: TenantsDeps = {
    repo,
    crearInvitacionAdmin,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };

  return {
    deps,
    organizations,
    invitacionCalls,
    setFailTransaccion,
    setInvitacionFalla: (falla: boolean) => (invitacionFalla = falla),
    updateOrganizationCallCount,
  };
}

const INPUT_VALIDO: CrearClubInput = {
  slug: 'el-montanista',
  name: 'Club El Montañista',
  membresiaPropia: 'SOCIO_EL_MONTANISTA',
  alertEmail: 'alertas@elmontanista.cl',
  contactName: 'Contacto Club',
  contactEmail: 'contacto@elmontanista.cl',
  adminEmail: 'admin@elmontanista.cl',
};

describe('crearClub', () => {
  it('camino feliz: crea la organización, 6 categorías, 1 declaración vigente y devuelve el link de invitación', async () => {
    const { deps, organizations, invitacionCalls } = createDeps();
    const result = await crearClub(deps, INPUT_VALIDO);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 201);
    assert.equal(result.body.categoriasCreadas, 6);
    assert.equal(result.body.declaracion.version, '2026-08');
    assert.equal(organizations.length, 1);
    assert.equal(organizations[0]?.slug, 'el-montanista');

    assert.equal(result.body.invitacion.emitida, true);
    if (result.body.invitacion.emitida) {
      assert.match(result.body.invitacion.inviteUrl, /^https:\/\/club\.test\/#invite=/);
    }
    assert.equal(invitacionCalls.length, 1);
    assert.equal(invitacionCalls[0]?.email, 'admin@elmontanista.cl');
    assert.equal(invitacionCalls[0]?.organizationId, organizations[0]?.id);
  });

  it('normaliza slug y emails a minúsculas', async () => {
    const { deps, organizations, invitacionCalls } = createDeps();
    const result = await crearClub(deps, {
      ...INPUT_VALIDO,
      slug: 'El-Montanista',
      alertEmail: 'Alertas@ElMontanista.cl',
      adminEmail: 'Admin@ElMontanista.cl',
    });

    assert.equal(result.ok, true);
    assert.equal(organizations[0]?.slug, 'el-montanista');
    assert.equal(invitacionCalls[0]?.email, 'admin@elmontanista.cl');
  });

  it('rechaza un slug con formato inválido', async () => {
    const { deps } = createDeps();
    const result = await crearClub(deps, { ...INPUT_VALIDO, slug: 'Club Inválido!' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
  });

  it('rechaza un slug ya usado por otro club', async () => {
    const existente: OrganizationRow = {
      id: 'org-existente',
      slug: 'el-montanista',
      name: 'Club Existente',
      shortName: null,
      status: 'ACTIVE',
      membresiaPropia: 'SOCIO_EL_MONTANISTA',
      alertEmail: 'alertas@existente.cl',
      contactName: 'Contacto Existente',
      contactEmail: 'contacto@existente.cl',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const { deps, organizations } = createDeps({}, [existente]);
    const result = await crearClub(deps, INPUT_VALIDO);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
    assert.equal(organizations.length, 1);
  });

  for (const membresiaInvalida of ['SOCIO_OTRO_CLUB', 'POSTULANTE_CLUB', 'NO_PERTENECE']) {
    it(`rechaza la membresía propia "${membresiaInvalida}" (no es una membresía de club válida)`, async () => {
      const { deps } = createDeps();
      const result = await crearClub(deps, { ...INPUT_VALIDO, membresiaPropia: membresiaInvalida });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 400);
    });
  }

  it('rechaza una membresía propia ya usada por otro club', async () => {
    const existente: OrganizationRow = {
      id: 'org-existente',
      slug: 'otro-slug',
      name: 'Club Existente',
      shortName: null,
      status: 'ACTIVE',
      membresiaPropia: 'SOCIO_EL_MONTANISTA',
      alertEmail: 'alertas@existente.cl',
      contactName: 'Contacto Existente',
      contactEmail: 'contacto@existente.cl',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const { deps, organizations } = createDeps({}, [existente]);
    const result = await crearClub(deps, INPUT_VALIDO);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
    assert.match(result.error, /otro-slug/);
    // No se creó ningún club nuevo: sigue habiendo solo el existente.
    assert.equal(organizations.length, 1);
  });

  it('si falla la invitación, el club queda creado igual y el resultado lo dice explícitamente', async () => {
    const { deps, organizations, invitacionCalls } = createDeps();
    // Fuerza la falla de la invitación reemplazando la función inyectada.
    const deriveDeps: TenantsDeps = {
      ...deps,
      crearInvitacionAdmin: async (organizationId, email) => {
        invitacionCalls.push({ organizationId, email });
        return { ok: false, status: 502, error: 'fallo simulado al emitir la invitación' };
      },
    };

    const result = await crearClub(deriveDeps, INPUT_VALIDO);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // El club se creó de todas formas: nunca se revierte un club ya comprometido.
    assert.equal(organizations.length, 1);
    assert.equal(result.body.invitacion.emitida, false);
    if (!result.body.invitacion.emitida) {
      assert.equal(result.body.invitacion.error, 'fallo simulado al emitir la invitación');
      assert.match(result.body.invitacion.comandoRecuperacion, /tenant:invite/);
      assert.match(result.body.invitacion.comandoRecuperacion, /el-montanista/);
    }
  });

  it('atomicidad: si la transacción del repositorio falla a mitad de camino, no queda ningún club creado', async () => {
    const { deps, organizations, setFailTransaccion, invitacionCalls } = createDeps();
    setFailTransaccion(true);

    await assert.rejects(() => crearClub(deps, INPUT_VALIDO));
    assert.equal(organizations.length, 0);
    // La invitación nunca debe intentarse si la transacción no llegó a comprometerse.
    assert.equal(invitacionCalls.length, 0);
  });
});

describe('listarClubes', () => {
  it('devuelve los clubes existentes', async () => {
    const seedOrg: OrganizationRow = {
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: null,
      status: 'ACTIVE',
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      alertEmail: 'alertas@pamir.cl',
      contactName: 'Contacto Pamir',
      contactEmail: 'contacto@pamir.cl',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const { deps } = createDeps({}, [seedOrg]);
    const clubes = await listarClubes(deps);
    assert.equal(clubes.length, 1);
    assert.equal(clubes[0]?.slug, 'pamir');
  });
});

describe('cambiarEstadoClub', () => {
  const SEED: OrganizationRow = {
    id: 'org-1',
    slug: 'pamir',
    name: 'Andino Club Pamir',
    shortName: null,
    status: 'ACTIVE' as OrganizationStatus,
    membresiaPropia: 'SOCIO_ANDINO_PAMIR',
    alertEmail: 'alertas@pamir.cl',
    contactName: 'Contacto Pamir',
    contactEmail: 'contacto@pamir.cl',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  it('devuelve 404 si el club no existe', async () => {
    const { deps } = createDeps();
    const result = await cambiarEstadoClub(deps, 'no-existe', 'SUSPENDED');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
  });

  it('suspende un club activo', async () => {
    const { deps, organizations } = createDeps({}, [{ ...SEED }]);
    const result = await cambiarEstadoClub(deps, 'pamir', 'SUSPENDED');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.estadoAnterior, 'ACTIVE');
    assert.equal(result.body.estadoNuevo, 'SUSPENDED');
    assert.equal(result.body.sinCambios, false);
    assert.equal(organizations[0]?.status, 'SUSPENDED');
  });

  it('reactivar un club ya activo es un no-op', async () => {
    const { deps } = createDeps({}, [{ ...SEED }]);
    const result = await cambiarEstadoClub(deps, 'pamir', 'ACTIVE');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.sinCambios, true);
    assert.equal(result.body.estadoAnterior, 'ACTIVE');
    assert.equal(result.body.estadoNuevo, 'ACTIVE');
  });
});

describe('invitarAdminClub', () => {
  it('devuelve 404 si el club no existe', async () => {
    const { deps } = createDeps();
    const result = await invitarAdminClub(deps, 'no-existe', 'admin@club.cl');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
  });

  it('rechaza un email inválido', async () => {
    const seedOrg: OrganizationRow = {
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: null,
      status: 'ACTIVE',
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      alertEmail: 'alertas@pamir.cl',
      contactName: 'Contacto Pamir',
      contactEmail: 'contacto@pamir.cl',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const { deps } = createDeps({}, [seedOrg]);
    const result = await invitarAdminClub(deps, 'pamir', 'no-es-un-email');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
  });

  it('reemite una invitación de plataforma para un club existente', async () => {
    const seedOrg: OrganizationRow = {
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: null,
      status: 'ACTIVE',
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      alertEmail: 'alertas@pamir.cl',
      contactName: 'Contacto Pamir',
      contactEmail: 'contacto@pamir.cl',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const { deps, invitacionCalls } = createDeps({}, [seedOrg]);
    const result = await invitarAdminClub(deps, 'pamir', 'Nuevo-Admin@Pamir.cl');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 201);
    assert.match(result.body.inviteUrl, /^https:\/\/club\.test\/#invite=/);
    assert.equal(invitacionCalls[0]?.email, 'nuevo-admin@pamir.cl');
    assert.equal(invitacionCalls[0]?.organizationId, 'org-1');
  });

  it('relaya el error del servicio de invitaciones cuando este falla', async () => {
    const seedOrg: OrganizationRow = {
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: null,
      status: 'ACTIVE',
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      alertEmail: 'alertas@pamir.cl',
      contactName: 'Contacto Pamir',
      contactEmail: 'contacto@pamir.cl',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };
    const { deps, setInvitacionFalla } = createDeps({}, [seedOrg]);
    setInvitacionFalla(true);
    const result = await invitarAdminClub(deps, 'pamir', 'admin@pamir.cl');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 502);
  });
});

describe('actualizarClub', () => {
  const SEED_UPDATE: OrganizationRow = {
    id: 'org-1',
    slug: 'pamir',
    name: 'Andino Club Pamir',
    shortName: 'Pamir',
    status: 'ACTIVE',
    membresiaPropia: 'SOCIO_ANDINO_PAMIR',
    alertEmail: 'alertas@pamir.cl',
    contactName: 'Contacto Pamir',
    contactEmail: 'contacto@pamir.cl',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  it('devuelve 404 si el club no existe', async () => {
    const { deps } = createDeps();
    const result = await actualizarClub(deps, 'no-existe', { name: 'Nuevo nombre' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
  });

  it('devuelve 400 si no se pasó ningún campo', async () => {
    const { deps } = createDeps({}, [{ ...SEED_UPDATE }]);
    const input: ActualizarClubInput = {};
    const result = await actualizarClub(deps, 'pamir', input);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
  });

  it('rechaza un nombre inválido', async () => {
    const { deps } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { name: 'x' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
  });

  it('rechaza un nombre corto inválido', async () => {
    const { deps } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { shortName: 'x'.repeat(61) });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
  });

  it('rechaza un nombre de contacto inválido', async () => {
    const { deps } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { contactName: '' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
  });

  it('rechaza un email de contacto inválido', async () => {
    const { deps } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { contactEmail: 'no-es-un-email' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
  });

  it('rechaza un email de alerta inválido', async () => {
    const { deps } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { alertEmail: 'no-es-un-email' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
  });

  it('cambia un solo campo y no toca slug, membresiaPropia ni status', async () => {
    const { deps, organizations } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { name: 'Nuevo Nombre Pamir' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.sinCambios, false);
    assert.deepEqual(result.body.cambios, [
      { campo: 'name', antes: 'Andino Club Pamir', despues: 'Nuevo Nombre Pamir' },
    ]);
    assert.equal(organizations[0]?.name, 'Nuevo Nombre Pamir');
    assert.equal(organizations[0]?.slug, 'pamir');
    assert.equal(organizations[0]?.membresiaPropia, 'SOCIO_ANDINO_PAMIR');
    assert.equal(organizations[0]?.status, 'ACTIVE');
  });

  it('cambia varios campos a la vez', async () => {
    const { deps, organizations } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', {
      name: 'Nuevo Nombre Pamir',
      contactName: 'Nuevo Contacto',
      contactEmail: 'nuevo-contacto@pamir.cl',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.cambios.length, 3);
    assert.equal(organizations[0]?.name, 'Nuevo Nombre Pamir');
    assert.equal(organizations[0]?.contactName, 'Nuevo Contacto');
    assert.equal(organizations[0]?.contactEmail, 'nuevo-contacto@pamir.cl');
  });

  it('limpia el nombre corto a null', async () => {
    const { deps, organizations } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { shortName: '' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.body.cambios, [{ campo: 'shortName', antes: 'Pamir', despues: null }]);
    assert.equal(organizations[0]?.shortName, null);
  });

  it('no-op: no llama al repositorio si ningún campo cambió realmente', async () => {
    const { deps, organizations, updateOrganizationCallCount } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { name: 'Andino Club Pamir' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.sinCambios, true);
    assert.deepEqual(result.body.cambios, []);
    assert.equal(updateOrganizationCallCount(), 0);
    assert.equal(organizations[0]?.name, 'Andino Club Pamir');
  });

  it('un email en mayúsculas que ya coincide (normalizado) no cuenta como cambio', async () => {
    const { deps, updateOrganizationCallCount } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { contactEmail: 'CONTACTO@PAMIR.CL' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.sinCambios, true);
    assert.equal(updateOrganizationCallCount(), 0);
  });

  it('cambia el email de alerta y lo refleja en el diff con el antes/después correctos', async () => {
    const { deps, organizations } = createDeps({}, [{ ...SEED_UPDATE }]);
    const result = await actualizarClub(deps, 'pamir', { alertEmail: 'nueva-alerta@pamir.cl' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.body.cambios, [
      { campo: 'alertEmail', antes: 'alertas@pamir.cl', despues: 'nueva-alerta@pamir.cl' },
    ]);
    assert.equal(organizations[0]?.alertEmail, 'nueva-alerta@pamir.cl');
  });
});
