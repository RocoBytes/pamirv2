import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEvento } from './evento.js';

describe('serializeEvento', () => {
  it('quita itinerarioFileUrl, conserva el resto (incluidas relaciones incluidas)', () => {
    const evento = {
      id: 'e1',
      titulo: 'Cerro Y',
      itinerarioFileId: 'orgs/a/itinerario/1.pdf',
      itinerarioFileName: 'itinerario.pdf',
      itinerarioFileUrl: 'https://legacy-storage.example/leaked',
      categoria: { id: 1, nombre: 'Trekking' },
    };
    const result = serializeEvento(evento);
    assert.equal('itinerarioFileUrl' in result, false);
    assert.equal(result.itinerarioFileId, 'orgs/a/itinerario/1.pdf');
    assert.deepEqual(result.categoria, { id: 1, nombre: 'Trekking' });
  });

  it('no muta el objeto original', () => {
    const evento = { id: 'e1', itinerarioFileUrl: 'x' };
    serializeEvento(evento);
    assert.equal(evento.itinerarioFileUrl, 'x');
  });
});
