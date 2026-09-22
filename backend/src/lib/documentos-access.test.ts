import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { puedeVerDocumentos } from './documentos-access.js';

describe('puedeVerDocumentos', () => {
  it('el admin siempre puede, sin importar la membresía', () => {
    assert.equal(
      puedeVerDocumentos({ isAdmin: true, integranteMembresiaClub: undefined, membresiaPropia: 'SOCIO_ANDINO_PAMIR' }),
      true,
    );
  });

  it('un socio cuya membresía coincide con la propia del club puede', () => {
    assert.equal(
      puedeVerDocumentos({
        isAdmin: false,
        integranteMembresiaClub: 'SOCIO_ANDINO_PAMIR',
        membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      }),
      true,
    );
  });

  it('un socio de OTRO club (membresía distinta) no puede', () => {
    assert.equal(
      puedeVerDocumentos({
        isAdmin: false,
        integranteMembresiaClub: 'SOCIO_EL_MONTANISTA',
        membresiaPropia: 'SOCIO_ANDINO_PAMIR',
      }),
      false,
    );
  });

  it('sin ficha de integrante (undefined) no puede', () => {
    assert.equal(
      puedeVerDocumentos({ isAdmin: false, integranteMembresiaClub: undefined, membresiaPropia: 'SOCIO_ANDINO_PAMIR' }),
      false,
    );
  });

  it('sin ficha de integrante (null) no puede', () => {
    assert.equal(
      puedeVerDocumentos({ isAdmin: false, integranteMembresiaClub: null, membresiaPropia: 'SOCIO_ANDINO_PAMIR' }),
      false,
    );
  });
});
