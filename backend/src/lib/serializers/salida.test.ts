import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeSalida } from './salida.js';

describe('serializeSalida', () => {
  it('quita gpxFileUrl y pronosticoFileUrl, conserva el resto', () => {
    const salida = {
      id: 's1',
      nombreActividad: 'Cerro X',
      gpxFileId: 'orgs/a/gpx/1.gpx',
      gpxFileName: 'ruta.gpx',
      gpxFileUrl: 'https://legacy-storage.example/leaked',
      pronosticoFileId: null,
      pronosticoFileName: null,
      pronosticoFileUrl: null,
    };
    const result = serializeSalida(salida);
    assert.equal('gpxFileUrl' in result, false);
    assert.equal('pronosticoFileUrl' in result, false);
    assert.equal(result.gpxFileId, 'orgs/a/gpx/1.gpx');
    assert.equal(result.nombreActividad, 'Cerro X');
  });

  it('no muta el objeto original', () => {
    const salida = { id: 's1', gpxFileUrl: 'x', pronosticoFileUrl: 'y' };
    serializeSalida(salida);
    assert.equal(salida.gpxFileUrl, 'x');
    assert.equal(salida.pronosticoFileUrl, 'y');
  });

  it('conserva propiedades adicionales (p.ej. include: { user })', () => {
    const salida = { id: 's1', gpxFileUrl: 'x', pronosticoFileUrl: 'y', user: { name: 'Ana', email: 'a@x.cl' } };
    const result = serializeSalida(salida);
    assert.deepEqual(result.user, { name: 'Ana', email: 'a@x.cl' });
  });
});
