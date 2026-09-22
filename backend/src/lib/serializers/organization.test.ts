import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicOrganization, toPublicOrganizationBrand } from './organization.js';

describe('toPublicOrganization', () => {
  it('expone exactamente id, slug, name, shortName y membresiaPropia', () => {
    const result = toPublicOrganization({
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: 'Pamir',
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
    });
    assert.deepEqual(Object.keys(result).sort(), ['id', 'membresiaPropia', 'name', 'shortName', 'slug']);
    assert.equal(result.slug, 'pamir');
    assert.equal(result.membresiaPropia, 'SOCIO_ANDINO_PAMIR');
  });

  it('nunca incluye alertEmail/contactName/contactEmail aunque vengan en la fuente', () => {
    const result = toPublicOrganization({
      id: 'org-1',
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: null,
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      alertEmail: 'alertas@pamir.cl',
      contactName: 'Secretaría',
      contactEmail: 'contacto@pamir.cl',
    } as never);
    assert.equal('alertEmail' in result, false);
    assert.equal('contactName' in result, false);
    assert.equal('contactEmail' in result, false);
  });

  it('preserva shortName null', () => {
    const result = toPublicOrganization({
      id: 'org-1',
      slug: 'el-montanista',
      name: 'Club Andino El Montañista',
      shortName: null,
      membresiaPropia: 'SOCIO_EL_MONTANISTA',
    });
    assert.equal(result.shortName, null);
  });
});

describe('toPublicOrganizationBrand', () => {
  it('expone exactamente slug, name y shortName', () => {
    const result = toPublicOrganizationBrand({
      slug: 'el-montanista',
      name: 'Club Andino El Montañista',
      shortName: 'El Montañista',
    });
    assert.deepEqual(Object.keys(result).sort(), ['name', 'shortName', 'slug']);
  });

  it('nunca incluye id ni membresiaPropia aunque vengan en la fuente', () => {
    const result = toPublicOrganizationBrand({
      slug: 'pamir',
      name: 'Andino Club Pamir',
      shortName: 'Pamir',
      id: 'org-1',
      membresiaPropia: 'SOCIO_ANDINO_PAMIR',
    } as never);
    assert.equal('id' in result, false);
    assert.equal('membresiaPropia' in result, false);
  });
});
