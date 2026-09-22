import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { logoVersionOf, toPublicOrganization, toPublicOrganizationBrand } from './organization.js';

describe('toPublicOrganization', () => {
  it('expone exactamente id, slug, name, shortName, membresiaPropia, hasLogo y logoVersion', () => {
    const result = toPublicOrganization({
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: 'Pamir',
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      logoObjectKey: null,
    });
    assert.deepEqual(
      Object.keys(result).sort(),
      ['hasLogo', 'id', 'logoVersion', 'membresiaPropia', 'name', 'shortName', 'slug'],
    );
    assert.equal(result.slug, 'pamir');
    assert.equal(result.membresiaPropia, 'SOCIO_ANDINO_PAMIR');
  });

  it('nunca incluye alertEmail/contactName/contactEmail ni logoObjectKey aunque vengan en la fuente', () => {
    const result = toPublicOrganization({
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: null,
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      logoObjectKey: 'orgs/org-1/logo/1.png',
      alertEmail: 'alertas@pamir.cl',
      contactName: 'Secretaría',
      contactEmail: 'contacto@pamir.cl',
    } as never);
    assert.equal('alertEmail' in result, false);
    assert.equal('contactName' in result, false);
    assert.equal('contactEmail' in result, false);
    assert.equal('logoObjectKey' in result, false);
  });

  it('preserva shortName null', () => {
    const result = toPublicOrganization({
      id: 'org-1',
      slug: 'el-montanista',
      name: 'Club Andino El Montañista',
      shortName: null,
      membresiaPropia: 'SOCIO_EL_MONTANISTA',
      logoObjectKey: null,
    });
    assert.equal(result.shortName, null);
  });

  it('hasLogo/logoVersion en null cuando el club no subió logo propio', () => {
    const result = toPublicOrganization({
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: null,
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      logoObjectKey: null,
    });
    assert.equal(result.hasLogo, false);
    assert.equal(result.logoVersion, null);
  });

  it('hasLogo/logoVersion derivados de logoObjectKey cuando el club subió un logo', () => {
    const key = 'orgs/org-1/logo/1234.png';
    const result = toPublicOrganization({
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: null,
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      logoObjectKey: key,
    });
    assert.equal(result.hasLogo, true);
    assert.equal(result.logoVersion, createHash('sha256').update(key).digest('hex').slice(0, 8));
  });
});

describe('toPublicOrganizationBrand', () => {
  it('expone exactamente slug, name, shortName, hasLogo y logoVersion', () => {
    const result = toPublicOrganizationBrand({
      slug: 'el-montanista',
      name: 'Club Andino El Montañista',
      shortName: 'El Montañista',
      logoObjectKey: null,
    });
    assert.deepEqual(Object.keys(result).sort(), ['hasLogo', 'logoVersion', 'name', 'shortName', 'slug']);
  });

  it('nunca incluye id, membresiaPropia ni logoObjectKey aunque vengan en la fuente', () => {
    const result = toPublicOrganizationBrand({
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: 'Pamir',
      logoObjectKey: 'orgs/org-1/logo/1.png',
      id: 'org-1',
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
    } as never);
    assert.equal('id' in result, false);
    assert.equal('membresiaPropia' in result, false);
    assert.equal('logoObjectKey' in result, false);
  });

  it('hasLogo/logoVersion siguen la misma derivación que toPublicOrganization', () => {
    const key = 'orgs/org-2/logo/5678.jpg';
    const result = toPublicOrganizationBrand({
      slug: 'el-montanista',
      name: 'Club Andino El Montañista',
      shortName: null,
      logoObjectKey: key,
    });
    assert.equal(result.hasLogo, true);
    assert.equal(result.logoVersion, createHash('sha256').update(key).digest('hex').slice(0, 8));
  });
});

describe('logoVersionOf', () => {
  it('es null para una clave null', () => {
    assert.equal(logoVersionOf(null), null);
  });

  it('son los primeros 8 caracteres del sha256 de la clave', () => {
    const key = 'orgs/org-1/logo/abc.png';
    assert.equal(logoVersionOf(key), createHash('sha256').update(key).digest('hex').slice(0, 8));
  });

  it('cambia si la clave cambia (cada subida genera un uuid nuevo)', () => {
    assert.notEqual(
      logoVersionOf('orgs/org-1/logo/uno.png'),
      logoVersionOf('orgs/org-1/logo/dos.png'),
    );
  });

  it('es determinístico para la misma clave', () => {
    const key = 'orgs/org-1/logo/abc.png';
    assert.equal(logoVersionOf(key), logoVersionOf(key));
  });
});
