import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  runWithOrganization,
  runAsPlatform,
  getTenantStore,
  requireOrganizationId,
  bindTenantContext,
  TenantContextError,
} from './tenant-context.js';

describe('getTenantStore', () => {
  it('es undefined fuera de cualquier run', () => {
    assert.equal(getTenantStore(), undefined);
  });
});

describe('runWithOrganization / runAsPlatform', () => {
  it('runWithOrganization expone un store de tipo org', () => {
    runWithOrganization('org-1', () => {
      assert.deepEqual(getTenantStore(), { kind: 'org', organizationId: 'org-1' });
    });
  });

  it('runAsPlatform expone un store de tipo platform', () => {
    runAsPlatform(() => {
      assert.deepEqual(getTenantStore(), { kind: 'platform' });
    });
  });

  it('el store no queda activo después de que run termina', () => {
    runWithOrganization('org-1', () => undefined);
    assert.equal(getTenantStore(), undefined);
  });

  it('el store propaga a través de fronteras await', async () => {
    await runWithOrganization('org-1', async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(getTenantStore(), { kind: 'org', organizationId: 'org-1' });
    });
  });

  it('un run anidado solo sustituye el store dentro de su propio alcance', async () => {
    await runWithOrganization('org-a', async () => {
      assert.deepEqual(getTenantStore(), { kind: 'org', organizationId: 'org-a' });

      await runAsPlatform(async () => {
        assert.deepEqual(getTenantStore(), { kind: 'platform' });

        await runWithOrganization('org-b', async () => {
          assert.deepEqual(getTenantStore(), { kind: 'org', organizationId: 'org-b' });
        });

        assert.deepEqual(getTenantStore(), { kind: 'platform' });
      });

      assert.deepEqual(getTenantStore(), { kind: 'org', organizationId: 'org-a' });
    });
  });

  it('devuelve el valor de retorno de fn', () => {
    const result = runWithOrganization('org-1', () => 42);
    assert.equal(result, 42);
  });
});

describe('requireOrganizationId', () => {
  it('devuelve el organizationId dentro de un contexto de club', () => {
    runWithOrganization('org-1', () => {
      assert.equal(requireOrganizationId(), 'org-1');
    });
  });

  it('lanza TenantContextError fuera de cualquier contexto', () => {
    assert.throws(() => requireOrganizationId(), TenantContextError);
  });

  it('lanza TenantContextError dentro de un contexto de plataforma', () => {
    runAsPlatform(() => {
      assert.throws(() => requireOrganizationId(), TenantContextError);
    });
  });
});

describe('bindTenantContext', () => {
  it('restaura el store capturado al invocarse desde un callback sin contexto (EventEmitter)', () => {
    const emitter = new EventEmitter();
    let observed: unknown = 'never-called';

    runWithOrganization('org-emitter', () => {
      const handler = bindTenantContext(() => {
        observed = getTenantStore();
      });
      emitter.on('evento', handler);
    });

    // En este punto ya no hay ningún contexto activo — simula la callback
    // asíncrona de busboy, que dispara fuera del alcance síncrono del handler.
    assert.equal(getTenantStore(), undefined);

    emitter.emit('evento');
    assert.deepEqual(observed, { kind: 'org', organizationId: 'org-emitter' });
  });

  it('propaga argumentos y el valor de retorno de la función envuelta', () => {
    const bound = runWithOrganization('org-1', () => bindTenantContext((a: number, b: number) => a + b));
    assert.equal(bound(2, 3), 5);
  });

  it('restaura un contexto de plataforma capturado, incluso tras un setImmediate', async () => {
    let observed: unknown;
    const done = new Promise<void>((resolve) => {
      runAsPlatform(() => {
        const handler = bindTenantContext(() => {
          observed = getTenantStore();
          resolve();
        });
        setImmediate(handler);
      });
    });

    assert.equal(getTenantStore(), undefined);
    await done;
    assert.deepEqual(observed, { kind: 'platform' });
  });

  it('si no había contexto activo al capturar, ejecuta fn sin envolver ningún store', () => {
    let observed: unknown = 'never-called';
    const handler = bindTenantContext(() => {
      observed = getTenantStore();
    });
    runWithOrganization('org-should-not-leak', () => {
      // Invocar el handler no debe heredar el contexto vigente en el momento
      // de la LLAMADA — solo importa el contexto vigente en el momento del bind.
      handler();
    });
    assert.equal(observed, undefined);
  });
});

// Las promesas de Prisma son perezosas: la consulta corre recién en `.then()`.
// Este thenable imita ese comportamiento sin base de datos: registra qué
// contexto había en el momento exacto en que se dispara.
function lazyThenable(): { thenable: PromiseLike<unknown>; firedWith: () => unknown } {
  let observed: unknown = 'never-fired';
  const thenable: PromiseLike<unknown> = {
    then(onFulfilled, onRejected) {
      observed = getTenantStore();
      return Promise.resolve(observed).then(onFulfilled, onRejected);
    },
  };
  return { thenable, firedWith: () => observed };
}

describe('promesas perezosas (como las de Prisma)', () => {
  it('runAsPlatform dispara el thenable DENTRO del contexto aunque fn no sea async', async () => {
    const lazy = lazyThenable();
    // El await ocurre fuera de runAsPlatform: sin el arreglo, el thenable se
    // dispararía aquí afuera y vería `undefined`.
    const result = await runAsPlatform(() => lazy.thenable);
    assert.deepEqual(lazy.firedWith(), { kind: 'platform' });
    assert.deepEqual(result, { kind: 'platform' });
  });

  it('runWithOrganization dispara el thenable dentro del contexto del club', async () => {
    const lazy = lazyThenable();
    await runWithOrganization('org-lazy', () => lazy.thenable);
    assert.deepEqual(lazy.firedWith(), { kind: 'org', organizationId: 'org-lazy' });
  });

  it('bindTenantContext dispara el thenable dentro del contexto capturado', async () => {
    const lazy = lazyThenable();
    const bound = runWithOrganization('org-bound', () => bindTenantContext(() => lazy.thenable));
    await bound();
    assert.deepEqual(lazy.firedWith(), { kind: 'org', organizationId: 'org-bound' });
  });

  it('propaga el rechazo del thenable', async () => {
    const failing: PromiseLike<unknown> = {
      then(_ok, onRejected) {
        return Promise.reject(new Error('fallo')).then(undefined, onRejected);
      },
    };
    await assert.rejects(async () => runAsPlatform(() => failing), /fallo/);
  });

  it('no altera el valor de retorno de una función síncrona', () => {
    assert.equal(runAsPlatform(() => 42), 42);
  });

  it('dentro de una función async, un await posterior sigue en contexto', async () => {
    const lazy = lazyThenable();
    await runWithOrganization('org-async', async () => {
      await Promise.resolve();
      await lazy.thenable;
    });
    assert.deepEqual(lazy.firedWith(), { kind: 'org', organizationId: 'org-async' });
  });
});
