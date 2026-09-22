import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MEMBRESIA_CLUBS, MEMBRESIAS_PROPIAS } from './membresias.js';

describe('MEMBRESIAS_PROPIAS', () => {
  it('es un subconjunto de MEMBRESIA_CLUBS', () => {
    for (const codigo of MEMBRESIAS_PROPIAS) {
      assert.ok((MEMBRESIA_CLUBS as readonly string[]).includes(codigo));
    }
  });

  it('nunca incluye SOCIO_OTRO_CLUB, POSTULANTE_CLUB ni NO_PERTENECE', () => {
    for (const prohibido of ['SOCIO_OTRO_CLUB', 'POSTULANTE_CLUB', 'NO_PERTENECE']) {
      assert.ok(!(MEMBRESIAS_PROPIAS as readonly string[]).includes(prohibido));
    }
  });

  // Alambre de tropiezo deliberado: fija el conjunto exacto para que agregar un
  // club obligue a pasar por acá y, con eso, a recordar que el frontend tiene
  // sus propias listas (la unión MembresiaClub, CLUB_BADGE_LABELS y
  // CLUB_FILTER_LABELS en types/salida.ts, y el z.enum del paso 3 del wizard).
  it('tiene exactamente los códigos de los clubes reales de hoy', () => {
    assert.deepEqual(MEMBRESIAS_PROPIAS, ['SOCIO_ANDINO_PAMIR', 'SOCIO_EL_MONTANISTA', 'SOCIO_ANDINO_TESTING']);
  });
});
