import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scopeArgs,
  TENANT_MODELS,
  GLOBAL_MODELS,
  ORGANIZATION_MODEL,
  TenantContextError,
} from './scope-args.js';
import type { TenantStore } from './tenant-context.js';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const platform: TenantStore = { kind: 'platform' };
const asA: TenantStore = { kind: 'org', organizationId: ORG_A };

// ─── store === undefined: fail closed para todo, sin importar el modelo ───────

describe('scopeArgs — sin contexto (store undefined)', () => {
  for (const model of [...TENANT_MODELS, ...GLOBAL_MODELS, ORGANIZATION_MODEL, 'ModeloInventado']) {
    it(`lanza para ${model}.findMany sin contexto`, () => {
      assert.throws(
        () => scopeArgs({ model, operation: 'findMany', args: {}, store: undefined }),
        TenantContextError,
      );
    });
  }
});

// ─── platform: paso directo, sin filtrar, para cualquier modelo ──────────────

describe('scopeArgs — contexto de plataforma', () => {
  it('deja pasar los args sin modificar para un modelo de tenant', () => {
    const args = { where: { id: '1' } };
    const result = scopeArgs({ model: 'Salida', operation: 'findMany', args, store: platform });
    assert.deepEqual(result, args);
  });

  it('deja pasar los args sin modificar para Organization', () => {
    const args = { where: { slug: 'club' } };
    const result = scopeArgs({ model: 'Organization', operation: 'findUnique', args, store: platform });
    assert.deepEqual(result, args);
  });

  it('no lanza aunque el modelo sea desconocido (platform no valida el set)', () => {
    assert.doesNotThrow(() =>
      scopeArgs({ model: 'ModeloInventado', operation: 'findMany', args: {}, store: platform }),
    );
  });
});

// ─── Modelos globales: User es el primero desde el diseño multi-club ─────────
// (ver scope-args.ts) — una cuenta ya no pertenece a un único club, así que
// escapa del aislamiento por organizationId por esta vía.

describe('scopeArgs — GLOBAL_MODELS', () => {
  it('contiene exactamente User — la única cuenta es global desde el diseño multi-club', () => {
    assert.deepEqual(GLOBAL_MODELS, ['User']);
  });

  it('deja pasar los args sin modificar para un modelo global, incluso bajo un contexto de club', () => {
    const args = { where: { id: '1' } };
    const result = scopeArgs({ model: 'User', operation: 'findMany', args, store: asA });
    assert.deepEqual(result, args);
  });
});

// ─── Modelo desconocido bajo contexto de club: fail closed ───────────────────

describe('scopeArgs — modelo desconocido bajo un contexto de club', () => {
  it('lanza en vez de dejarlo pasar sin filtrar', () => {
    assert.throws(
      () => scopeArgs({ model: 'ModeloInventado', operation: 'findMany', args: {}, store: asA }),
      TenantContextError,
    );
  });
});

// ─── Cada tipo de operación sobre un modelo de tenant ─────────────────────────

const READ_DELETE_OPS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'delete',
  'deleteMany',
];

describe('scopeArgs — operaciones de lectura/borrado (solo where)', () => {
  for (const operation of READ_DELETE_OPS) {
    it(`agrega organizationId al where de ${operation}`, () => {
      const result = scopeArgs({
        model: 'Salida',
        operation,
        args: { where: { id: 'salida-1' } },
        store: asA,
      }) as { where: Record<string, unknown> };
      assert.deepEqual(result.where, { id: 'salida-1', organizationId: ORG_A });
    });

    it(`funciona sin where en absoluto para ${operation}`, () => {
      const result = scopeArgs({ model: 'Salida', operation, args: {}, store: asA }) as {
        where: Record<string, unknown>;
      };
      assert.deepEqual(result.where, { organizationId: ORG_A });
    });

    it(`lanza si el where de ${operation} ya trae un organizationId distinto`, () => {
      assert.throws(
        () =>
          scopeArgs({
            model: 'Salida',
            operation,
            args: { where: { organizationId: ORG_B } },
            store: asA,
          }),
        TenantContextError,
      );
    });
  }

  it('un where con un OR de nivel superior conserva el OR y agrega organizationId como AND', () => {
    const args = { where: { OR: [{ userId: 'u1' }, { userId: 'u2' }] } };
    const result = scopeArgs({ model: 'Salida', operation: 'findMany', args, store: asA }) as {
      where: Record<string, unknown>;
    };
    assert.deepEqual(result.where, {
      OR: [{ userId: 'u1' }, { userId: 'u2' }],
      organizationId: ORG_A,
    });
  });

  it('un where con clave única compuesta admite organizationId como filtro adicional', () => {
    const args = { where: { organizationId_rut: { organizationId: ORG_A, rut: '1-9' } } };
    const result = scopeArgs({ model: 'Integrante', operation: 'findUnique', args, store: asA }) as {
      where: Record<string, unknown>;
    };
    assert.deepEqual(result.where, {
      organizationId_rut: { organizationId: ORG_A, rut: '1-9' },
      organizationId: ORG_A,
    });
  });
});

describe('scopeArgs — update / updateMany / updateManyAndReturn', () => {
  for (const operation of ['update', 'updateMany', 'updateManyAndReturn']) {
    it(`agrega organizationId al where de ${operation}`, () => {
      const result = scopeArgs({
        model: 'Salida',
        operation,
        args: { where: { id: 'salida-1' }, data: { status: 'CANCELADA' } },
        store: asA,
      }) as { where: Record<string, unknown> };
      assert.deepEqual(result.where, { id: 'salida-1', organizationId: ORG_A });
    });

    it(`deja pasar data sin organizationId en ${operation}`, () => {
      const result = scopeArgs({
        model: 'Salida',
        operation,
        args: { where: { id: 'salida-1' }, data: { status: 'CANCELADA' } },
        store: asA,
      }) as { data: Record<string, unknown> };
      assert.deepEqual(result.data, { status: 'CANCELADA' });
    });

    it(`lanza si data.organizationId de ${operation} difiere del contexto (una fila no cambia de club)`, () => {
      assert.throws(
        () =>
          scopeArgs({
            model: 'Salida',
            operation,
            args: { where: { id: 'salida-1' }, data: { organizationId: ORG_B } },
            store: asA,
          }),
        TenantContextError,
      );
    });

    it(`no lanza si data.organizationId de ${operation} coincide con el contexto`, () => {
      assert.doesNotThrow(() =>
        scopeArgs({
          model: 'Salida',
          operation,
          args: { where: { id: 'salida-1' }, data: { organizationId: ORG_A } },
          store: asA,
        }),
      );
    });
  }
});

describe('scopeArgs — create / createManyAndReturn', () => {
  for (const operation of ['create', 'createManyAndReturn']) {
    it(`exige organizationId igual al contexto en data de ${operation}`, () => {
      const result = scopeArgs({
        model: 'Salida',
        operation,
        args: { data: { organizationId: ORG_A, nombreActividad: 'x' } },
        store: asA,
      }) as { data: Record<string, unknown> };
      assert.deepEqual(result.data, { organizationId: ORG_A, nombreActividad: 'x' });
    });

    it(`lanza si data.organizationId de ${operation} falta`, () => {
      assert.throws(
        () => scopeArgs({ model: 'Salida', operation, args: { data: { nombreActividad: 'x' } }, store: asA }),
        TenantContextError,
      );
    });

    it(`lanza si data.organizationId de ${operation} difiere del contexto`, () => {
      assert.throws(
        () =>
          scopeArgs({
            model: 'Salida',
            operation,
            args: { data: { organizationId: ORG_B, nombreActividad: 'x' } },
            store: asA,
          }),
        TenantContextError,
      );
    });
  }
});

describe('scopeArgs — createMany (data puede ser objeto o arreglo)', () => {
  it('exige organizationId igual al contexto en cada fila del arreglo', () => {
    const args = {
      data: [
        { organizationId: ORG_A, rut: '1' },
        { organizationId: ORG_A, rut: '2' },
      ],
    };
    const result = scopeArgs({ model: 'Integrante', operation: 'createMany', args, store: asA }) as {
      data: Record<string, unknown>[];
    };
    assert.deepEqual(result.data, args.data);
  });

  it('lanza si alguna fila del arreglo trae un organizationId distinto', () => {
    const args = {
      data: [
        { organizationId: ORG_A, rut: '1' },
        { organizationId: ORG_B, rut: '2' },
      ],
    };
    assert.throws(
      () => scopeArgs({ model: 'Integrante', operation: 'createMany', args, store: asA }),
      TenantContextError,
    );
  });

  it('exige organizationId igual al contexto cuando data es un único objeto', () => {
    const args = { data: { organizationId: ORG_A, rut: '1' } };
    assert.doesNotThrow(() => scopeArgs({ model: 'Integrante', operation: 'createMany', args, store: asA }));
  });
});

describe('scopeArgs — upsert', () => {
  it('escala where, create y update por separado', () => {
    const args = {
      where: { id: 'salida-1' },
      create: { organizationId: ORG_A, nombreActividad: 'x' },
      update: { nombreActividad: 'y' },
    };
    const result = scopeArgs({ model: 'Salida', operation: 'upsert', args, store: asA }) as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    assert.deepEqual(result.where, { id: 'salida-1', organizationId: ORG_A });
    assert.deepEqual(result.create, { organizationId: ORG_A, nombreActividad: 'x' });
    assert.deepEqual(result.update, { nombreActividad: 'y' });
  });

  it('lanza si create.organizationId difiere del contexto', () => {
    assert.throws(
      () =>
        scopeArgs({
          model: 'Salida',
          operation: 'upsert',
          args: { where: { id: 'x' }, create: { organizationId: ORG_B }, update: {} },
          store: asA,
        }),
      TenantContextError,
    );
  });

  it('lanza si update.organizationId difiere del contexto', () => {
    assert.throws(
      () =>
        scopeArgs({
          model: 'Salida',
          operation: 'upsert',
          args: { where: { id: 'x' }, create: { organizationId: ORG_A }, update: { organizationId: ORG_B } },
          store: asA,
        }),
      TenantContextError,
    );
  });

  it('lanza si where ya trae un organizationId distinto', () => {
    assert.throws(
      () =>
        scopeArgs({
          model: 'Salida',
          operation: 'upsert',
          args: { where: { organizationId: ORG_B }, create: { organizationId: ORG_A }, update: {} },
          store: asA,
        }),
      TenantContextError,
    );
  });
});

describe('scopeArgs — operación desconocida sobre un modelo de tenant', () => {
  it('lanza en vez de ejecutar sin filtrar', () => {
    assert.throws(
      () => scopeArgs({ model: 'Salida', operation: 'operacionInventada', args: {}, store: asA }),
      TenantContextError,
    );
  });
});

// ─── Organization: auto-alcanzado a where.id === organizationId ──────────────

describe('scopeArgs — Organization (auto-alcanzado)', () => {
  it('agrega where.id = organizationId en findUnique', () => {
    const result = scopeArgs({ model: 'Organization', operation: 'findUnique', args: {}, store: asA }) as {
      where: Record<string, unknown>;
    };
    assert.deepEqual(result.where, { id: ORG_A });
  });

  it('lanza si where.id difiere del contexto', () => {
    assert.throws(
      () =>
        scopeArgs({
          model: 'Organization',
          operation: 'findUnique',
          args: { where: { id: ORG_B } },
          store: asA,
        }),
      TenantContextError,
    );
  });

  it('permite update de la propia organización y conserva data', () => {
    const result = scopeArgs({
      model: 'Organization',
      operation: 'update',
      args: { where: { id: ORG_A }, data: { ultimoNumeroSalida: { increment: 1 } } },
      store: asA,
    }) as { where: Record<string, unknown>; data: Record<string, unknown> };
    assert.deepEqual(result.where, { id: ORG_A });
    assert.deepEqual(result.data, { ultimoNumeroSalida: { increment: 1 } });
  });

  it('lanza en create (dar de alta un club es una operación de plataforma)', () => {
    assert.throws(
      () => scopeArgs({ model: 'Organization', operation: 'create', args: { data: {} }, store: asA }),
      TenantContextError,
    );
  });

  it('lanza en createMany', () => {
    assert.throws(
      () => scopeArgs({ model: 'Organization', operation: 'createMany', args: { data: [] }, store: asA }),
      TenantContextError,
    );
  });
});

// ─── No mutar el objeto de entrada del llamador ───────────────────────────────

describe('scopeArgs — no muta los args de entrada', () => {
  it('no modifica el objeto where original', () => {
    const where = { id: 'salida-1' };
    const args = { where };
    scopeArgs({ model: 'Salida', operation: 'findMany', args, store: asA });
    assert.deepEqual(where, { id: 'salida-1' });
    assert.equal('organizationId' in where, false);
  });

  it('no modifica el objeto data original en create', () => {
    const data = { organizationId: ORG_A, nombreActividad: 'x' };
    const args = { data };
    scopeArgs({ model: 'Salida', operation: 'create', args, store: asA });
    assert.deepEqual(data, { organizationId: ORG_A, nombreActividad: 'x' });
  });

  it('no modifica el objeto args de nivel superior original', () => {
    const args = { where: { id: 'salida-1' }, select: { id: true } };
    scopeArgs({ model: 'Salida', operation: 'findMany', args, store: asA });
    assert.deepEqual(args.where, { id: 'salida-1' });
  });
});

// ─── El set de modelos declarado acá no puede divergir del schema ────────────

describe('TENANT_MODELS ∪ GLOBAL_MODELS ∪ {Organization} vs. schema.prisma', () => {
  it('cubre exactamente los modelos declarados en prisma/schema.prisma', () => {
    const schemaPath = new URL('../../prisma/schema.prisma', import.meta.url);
    const schemaText = readFileSync(schemaPath, 'utf8');
    const modelNames = [...schemaText.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);

    assert.ok(modelNames.length > 0, 'no se encontró ningún "model" en schema.prisma — ¿cambió el formato?');

    const declared = [...TENANT_MODELS, ...GLOBAL_MODELS, ORGANIZATION_MODEL].sort();
    assert.deepEqual([...modelNames].sort(), declared);
  });
});
