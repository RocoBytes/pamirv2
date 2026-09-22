import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteStoredFileBestEffort } from './delete-best-effort.js';

describe('deleteStoredFileBestEffort', () => {
  it('ignora en silencio un id legado de Google Drive (no tiene forma de clave de objeto)', async () => {
    await assert.doesNotReject(() => deleteStoredFileBestEffort('1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'test'));
  });

  it('ignora null/undefined', async () => {
    await assert.doesNotReject(() => deleteStoredFileBestEffort(null, 'test'));
    await assert.doesNotReject(() => deleteStoredFileBestEffort(undefined, 'test'));
  });

  it('nunca lanza para una clave de objeto real (adaptador de memoria por defecto en tests)', async () => {
    const key = 'orgs/a1b2c3d4-e5f6-4789-90ab-cdef01234567/gpx/11111111-1111-4111-8111-111111111111.gpx';
    await assert.doesNotReject(() => deleteStoredFileBestEffort(key, 'test'));
  });
});
