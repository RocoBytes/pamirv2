import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTenantArgs } from './tenant-args.js';

const CREATE_VALIDO = [
  '--slug', 'el-montanista',
  '--name', 'Club El Montañista',
  '--membresia', 'SOCIO_EL_MONTANISTA',
  '--alert-email', 'alertas@elmontanista.cl',
  '--contact-name', 'Contacto Club',
  '--contact-email', 'contacto@elmontanista.cl',
  '--admin-email', 'admin@elmontanista.cl',
];

describe('parseTenantArgs — comando desconocido', () => {
  it('rechaza un comando inexistente', () => {
    const result = parseTenantArgs(['borrar', '--slug', 'pamir']);
    assert.equal(result.success, false);
  });

  it('rechaza argv vacío', () => {
    const result = parseTenantArgs([]);
    assert.equal(result.success, false);
  });
});

describe('parseTenantArgs — list', () => {
  it('acepta "list" sin flags', () => {
    const result = parseTenantArgs(['list']);
    assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.data, { command: 'list' });
  });

  it('rechaza un flag desconocido en "list"', () => {
    const result = parseTenantArgs(['list', '--bogus']);
    assert.equal(result.success, false);
  });
});

describe('parseTenantArgs — create', () => {
  it('camino feliz', () => {
    const result = parseTenantArgs(['create', ...CREATE_VALIDO]);
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.data, {
        command: 'create',
        slug: 'el-montanista',
        name: 'Club El Montañista',
        shortName: null,
        membresia: 'SOCIO_EL_MONTANISTA',
        alertEmail: 'alertas@elmontanista.cl',
        contactName: 'Contacto Club',
        contactEmail: 'contacto@elmontanista.cl',
        adminEmail: 'admin@elmontanista.cl',
      });
    }
  });

  it('acepta --short-name', () => {
    const result = parseTenantArgs(['create', ...CREATE_VALIDO, '--short-name', 'El Montañista']);
    assert.equal(result.success, true);
    if (result.success && result.data.command === 'create') {
      assert.equal(result.data.shortName, 'El Montañista');
    }
  });

  it('normaliza el slug y los emails a minúsculas, y recorta espacios', () => {
    const result = parseTenantArgs([
      'create',
      '--slug', '  El-Montanista  ',
      '--name', 'Club El Montañista',
      '--membresia', 'SOCIO_EL_MONTANISTA',
      '--alert-email', '  Alertas@ElMontanista.cl  ',
      '--contact-name', 'Contacto Club',
      '--contact-email', 'Contacto@ElMontanista.cl',
      '--admin-email', 'Admin@ElMontanista.cl',
    ]);
    assert.equal(result.success, true);
    if (result.success && result.data.command === 'create') {
      assert.equal(result.data.slug, 'el-montanista');
      assert.equal(result.data.alertEmail, 'alertas@elmontanista.cl');
      assert.equal(result.data.contactEmail, 'contacto@elmontanista.cl');
      assert.equal(result.data.adminEmail, 'admin@elmontanista.cl');
    }
  });

  for (const flag of [
    '--slug', '--name', '--membresia', '--alert-email', '--contact-name', '--contact-email', '--admin-email',
  ]) {
    it(`rechaza "create" sin ${flag}`, () => {
      const args = [...CREATE_VALIDO];
      const idx = args.indexOf(flag);
      args.splice(idx, 2);
      const result = parseTenantArgs(['create', ...args]);
      assert.equal(result.success, false);
    });
  }

  it('rechaza un slug con formato inválido', () => {
    const args = [...CREATE_VALIDO];
    args[args.indexOf('--slug') + 1] = 'Club Inválido!';
    const result = parseTenantArgs(['create', ...args]);
    assert.equal(result.success, false);
  });

  it('rechaza un slug de un solo carácter', () => {
    const args = [...CREATE_VALIDO];
    args[args.indexOf('--slug') + 1] = 'a';
    const result = parseTenantArgs(['create', ...args]);
    assert.equal(result.success, false);
  });

  it('rechaza una membresía inválida', () => {
    const args = [...CREATE_VALIDO];
    args[args.indexOf('--membresia') + 1] = 'SOCIO_OTRO_CLUB';
    const result = parseTenantArgs(['create', ...args]);
    assert.equal(result.success, false);
  });

  it('rechaza un email de alerta inválido', () => {
    const args = [...CREATE_VALIDO];
    args[args.indexOf('--alert-email') + 1] = 'no-es-un-email';
    const result = parseTenantArgs(['create', ...args]);
    assert.equal(result.success, false);
  });

  it('rechaza un flag desconocido', () => {
    const result = parseTenantArgs(['create', ...CREATE_VALIDO, '--bogus', 'x']);
    assert.equal(result.success, false);
  });

  for (const slugReservado of [
    'iso-test-foo', 'ISO-TEST-FOO', 'platform', 'plataforma', 'admin', 'api', 'www', 'app', 'riala',
    'assets', 'auth', 'brand',
  ]) {
    it(`rechaza el slug reservado "${slugReservado}"`, () => {
      const args = [...CREATE_VALIDO];
      args[args.indexOf('--slug') + 1] = slugReservado;
      const result = parseTenantArgs(['create', ...args]);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(result.errors.some((e) => e.includes('reservad')));
      }
    });
  }
});

describe('parseTenantArgs — suspend / activate', () => {
  for (const command of ['suspend', 'activate'] as const) {
    it(`"${command}" camino feliz`, () => {
      const result = parseTenantArgs([command, '--slug', 'pamir']);
      assert.equal(result.success, true);
      if (result.success) assert.deepEqual(result.data, { command, slug: 'pamir' });
    });

    it(`"${command}" rechaza sin --slug`, () => {
      const result = parseTenantArgs([command]);
      assert.equal(result.success, false);
    });

    it(`"${command}" normaliza el slug a minúsculas`, () => {
      const result = parseTenantArgs([command, '--slug', 'PAMIR']);
      assert.equal(result.success, true);
      if (result.success && (result.data.command === 'suspend' || result.data.command === 'activate')) {
        assert.equal(result.data.slug, 'pamir');
      }
    });

    it(`"${command}" rechaza un slug reservado`, () => {
      const result = parseTenantArgs([command, '--slug', 'admin']);
      assert.equal(result.success, false);
    });

    it(`"${command}" rechaza "brand" como slug reservado`, () => {
      const result = parseTenantArgs([command, '--slug', 'brand']);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(result.errors.some((e) => e.includes('reservad')));
      }
    });

    it(`"${command}" rechaza un flag desconocido`, () => {
      const result = parseTenantArgs([command, '--slug', 'pamir', '--bogus']);
      assert.equal(result.success, false);
    });
  }
});

describe('parseTenantArgs — invite', () => {
  it('camino feliz', () => {
    const result = parseTenantArgs(['invite', '--slug', 'pamir', '--admin-email', 'admin@pamir.cl']);
    assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.data, { command: 'invite', slug: 'pamir', adminEmail: 'admin@pamir.cl' });
  });

  it('normaliza slug y email', () => {
    const result = parseTenantArgs(['invite', '--slug', 'PAMIR', '--admin-email', 'Admin@Pamir.cl']);
    assert.equal(result.success, true);
    if (result.success && result.data.command === 'invite') {
      assert.equal(result.data.slug, 'pamir');
      assert.equal(result.data.adminEmail, 'admin@pamir.cl');
    }
  });

  it('rechaza sin --slug', () => {
    const result = parseTenantArgs(['invite', '--admin-email', 'admin@pamir.cl']);
    assert.equal(result.success, false);
  });

  it('rechaza sin --admin-email', () => {
    const result = parseTenantArgs(['invite', '--slug', 'pamir']);
    assert.equal(result.success, false);
  });

  it('rechaza un email inválido', () => {
    const result = parseTenantArgs(['invite', '--slug', 'pamir', '--admin-email', 'no-es-un-email']);
    assert.equal(result.success, false);
  });
});

describe('parseTenantArgs — update', () => {
  it('un solo campo: los demás quedan undefined', () => {
    const result = parseTenantArgs(['update', '--slug', 'pamir', '--name', 'Nuevo Nombre']);
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.data, {
        command: 'update',
        slug: 'pamir',
        name: 'Nuevo Nombre',
        shortName: undefined,
        contactName: undefined,
        contactEmail: undefined,
        alertEmail: undefined,
      });
    }
  });

  it('varios campos a la vez', () => {
    const result = parseTenantArgs([
      'update',
      '--slug', 'pamir',
      '--name', 'Nuevo Nombre',
      '--contact-name', 'Nuevo Contacto',
      '--contact-email', 'nuevo@pamir.cl',
    ]);
    assert.equal(result.success, true);
    if (result.success && result.data.command === 'update') {
      assert.equal(result.data.name, 'Nuevo Nombre');
      assert.equal(result.data.contactName, 'Nuevo Contacto');
      assert.equal(result.data.contactEmail, 'nuevo@pamir.cl');
      assert.equal(result.data.alertEmail, undefined);
      assert.equal(result.data.shortName, undefined);
    }
  });

  it('--short-name "" limpia el nombre corto a null', () => {
    const result = parseTenantArgs(['update', '--slug', 'pamir', '--short-name', '']);
    assert.equal(result.success, true);
    if (result.success && result.data.command === 'update') {
      assert.equal(result.data.shortName, null);
    }
  });

  it('omitir --short-name lo deja undefined (no lo toca) — caso distinto de limpiarlo', () => {
    const result = parseTenantArgs(['update', '--slug', 'pamir', '--name', 'Nuevo Nombre']);
    assert.equal(result.success, true);
    if (result.success && result.data.command === 'update') {
      assert.equal(result.data.shortName, undefined);
    }
  });

  it('rechaza sin --slug', () => {
    const result = parseTenantArgs(['update', '--name', 'Nuevo Nombre']);
    assert.equal(result.success, false);
  });

  it('rechaza sin ningún campo editable, y el mensaje lista los flags', () => {
    const result = parseTenantArgs(['update', '--slug', 'pamir']);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes('--name')));
      assert.ok(result.errors.some((e) => e.includes('--short-name')));
      assert.ok(result.errors.some((e) => e.includes('--contact-name')));
      assert.ok(result.errors.some((e) => e.includes('--contact-email')));
      assert.ok(result.errors.some((e) => e.includes('--alert-email')));
    }
  });

  it('rechaza un slug reservado', () => {
    const result = parseTenantArgs(['update', '--slug', 'admin', '--name', 'Nuevo Nombre']);
    assert.equal(result.success, false);
  });

  it('rechaza un slug con formato inválido', () => {
    const result = parseTenantArgs(['update', '--slug', 'Club Inválido!', '--name', 'Nuevo Nombre']);
    assert.equal(result.success, false);
  });

  it('rechaza --name vacío', () => {
    const result = parseTenantArgs(['update', '--slug', 'pamir', '--name', '']);
    assert.equal(result.success, false);
  });

  it('rechaza un --contact-email inválido', () => {
    const result = parseTenantArgs(['update', '--slug', 'pamir', '--contact-email', 'no-es-un-email']);
    assert.equal(result.success, false);
  });

  it('rechaza un --alert-email inválido', () => {
    const result = parseTenantArgs(['update', '--slug', 'pamir', '--alert-email', 'no-es-un-email']);
    assert.equal(result.success, false);
  });

  it('normaliza el slug y los emails a minúsculas, y recorta espacios', () => {
    const result = parseTenantArgs([
      'update',
      '--slug', '  PAMIR  ',
      '--contact-email', '  Nuevo@Pamir.cl  ',
      '--alert-email', '  Alertas@Pamir.cl  ',
    ]);
    assert.equal(result.success, true);
    if (result.success && result.data.command === 'update') {
      assert.equal(result.data.slug, 'pamir');
      assert.equal(result.data.contactEmail, 'nuevo@pamir.cl');
      assert.equal(result.data.alertEmail, 'alertas@pamir.cl');
    }
  });

  it('rechaza un flag desconocido', () => {
    const result = parseTenantArgs(['update', '--slug', 'pamir', '--name', 'Nuevo Nombre', '--bogus', 'x']);
    assert.equal(result.success, false);
  });
});
