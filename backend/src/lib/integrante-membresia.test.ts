import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { membresiaParaNuevaFicha } from './integrante-membresia.js';

describe('membresiaParaNuevaFicha', () => {
  it('asigna la membresía propia del club que crea la ficha', () => {
    assert.deepEqual(
      membresiaParaNuevaFicha({ organization: { membresiaPropia: 'SOCIO_ANDINO_PAMIR' } }),
      { membresiaClub: 'SOCIO_ANDINO_PAMIR', nombreClub: null },
    );
  });

  it('cambia con el club: cada organización obtiene SU PROPIA membresía, nunca un valor fijo', () => {
    assert.deepEqual(
      membresiaParaNuevaFicha({ organization: { membresiaPropia: 'SOCIO_EL_MONTANISTA' } }),
      { membresiaClub: 'SOCIO_EL_MONTANISTA', nombreClub: null },
    );
  });

  it('nombreClub siempre es null: una ficha nueva nunca queda "de otro club" ni "postulante"', () => {
    const resultado = membresiaParaNuevaFicha({ organization: { membresiaPropia: 'SOCIO_ANDINO_PAMIR' } });
    assert.equal(resultado.nombreClub, null);
  });
});
