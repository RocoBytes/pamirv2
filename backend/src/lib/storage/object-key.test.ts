import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildObjectKey,
  isObjectKey,
  objectKeyBelongsTo,
  organizationPrefix,
  assertSafeObjectPrefix,
  type FileKind,
} from './object-key.js';

const ORG = 'a1b2c3d4-e5f6-4789-90ab-cdef01234567';

describe('buildObjectKey', () => {
  it('construye la forma orgs/{org}/{kind}/{uuid}.{ext}', () => {
    const key = buildObjectKey({ organizationId: ORG, kind: 'gpx', extension: 'gpx' });
    assert.match(key, new RegExp(`^orgs/${ORG}/gpx/[0-9a-f-]{36}\\.gpx$`));
    assert.equal(isObjectKey(key), true);
  });

  it('acepta el kind "logo"', () => {
    const key = buildObjectKey({ organizationId: ORG, kind: 'logo', extension: 'png' });
    assert.match(key, new RegExp(`^orgs/${ORG}/logo/[0-9a-f-]{36}\\.png$`));
    assert.equal(isObjectKey(key), true);
  });

  it('genera una clave distinta en cada llamada', () => {
    const a = buildObjectKey({ organizationId: ORG, kind: 'documento', extension: 'pdf' });
    const b = buildObjectKey({ organizationId: ORG, kind: 'documento', extension: 'pdf' });
    assert.notEqual(a, b);
  });

  it('normaliza la extensión a minúsculas', () => {
    const key = buildObjectKey({ organizationId: ORG, kind: 'pronostico', extension: 'PDF' });
    assert.ok(key.endsWith('.pdf'));
  });

  for (const bad of ['../etc', 'org/with/slash', 'org.with.dot', 'org with space', '', 'a'.repeat(65)]) {
    it(`rechaza organizationId inválido: ${JSON.stringify(bad)}`, () => {
      assert.throws(() => buildObjectKey({ organizationId: bad, kind: 'gpx', extension: 'gpx' }));
    });
  }

  for (const bad of ['', 'p.df', 'toolongext', 'p/df', '!!!']) {
    it(`rechaza extensión inválida: ${JSON.stringify(bad)}`, () => {
      assert.throws(() => buildObjectKey({ organizationId: ORG, kind: 'gpx', extension: bad }));
    });
  }

  it('rechaza un kind desconocido', () => {
    assert.throws(() => buildObjectKey({ organizationId: ORG, kind: 'otro' as FileKind, extension: 'gpx' }));
  });
});

describe('isObjectKey', () => {
  it('es falso para un id de Google Drive legado', () => {
    assert.equal(isObjectKey('1AbCdEfGhIjKlMnOpQrStUvWxYz012345'), false);
  });

  it('es falso para intentos de traversal o rutas alteradas', () => {
    const base = buildObjectKey({ organizationId: ORG, kind: 'gpx', extension: 'gpx' });
    assert.equal(isObjectKey(`../${base}`), false);
    assert.equal(isObjectKey(base.replace('orgs/', 'orgs//')), false);
    assert.equal(isObjectKey(`${base}/../../etc/passwd`), false);
    assert.equal(isObjectKey(base.toUpperCase()), false);
  });

  it('es falso para null/undefined/no-string', () => {
    assert.equal(isObjectKey(null), false);
    assert.equal(isObjectKey(undefined), false);
  });
});

describe('objectKeyBelongsTo', () => {
  it('es verdadero solo bajo el propio club', () => {
    const key = buildObjectKey({ organizationId: ORG, kind: 'gpx', extension: 'gpx' });
    assert.equal(objectKeyBelongsTo(key, ORG), true);
    assert.equal(objectKeyBelongsTo(key, 'otro-club'), false);
  });

  it('es falso para una clave que no tiene forma de objeto', () => {
    assert.equal(objectKeyBelongsTo('1AbCdEfGhIjKlMnOpQrStUvWxYz012345', ORG), false);
  });
});

describe('organizationPrefix / assertSafeObjectPrefix', () => {
  it('produce orgs/{id}/', () => {
    assert.equal(organizationPrefix(ORG), `orgs/${ORG}/`);
  });

  it('lanza para un id inválido', () => {
    assert.throws(() => organizationPrefix('../'));
  });

  it('acepta solo el prefijo bien formado de un club', () => {
    assert.doesNotThrow(() => assertSafeObjectPrefix(organizationPrefix(ORG)));
    for (const bad of ['', 'orgs/', 'orgs//', '/', 'orgs/../', `orgs/${ORG}`, `orgs/${ORG}/extra/`]) {
      assert.throws(() => assertSafeObjectPrefix(bad), `esperaba que "${bad}" fuera rechazado`);
    }
  });
});
