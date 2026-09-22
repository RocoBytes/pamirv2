import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFileDownload } from './resolve-file-download.js';
import { buildObjectKey } from './object-key.js';

const ORG = 'org-aaaaaaaa';
const OTHER_ORG = 'org-bbbbbbbb';

describe('resolveFileDownload', () => {
  it('signed: la clave de objeto pertenece al club', () => {
    const key = buildObjectKey({ organizationId: ORG, kind: 'gpx', extension: 'gpx' });
    const result = resolveFileDownload({ fileId: key, legacyUrl: null, downloadName: 'salida.gpx' }, ORG);
    assert.deepEqual(result, { kind: 'signed', key, downloadName: 'salida.gpx' });
  });

  it('mismatch: la clave de objeto pertenece a OTRO club', () => {
    const key = buildObjectKey({ organizationId: OTHER_ORG, kind: 'gpx', extension: 'gpx' });
    const result = resolveFileDownload({ fileId: key, legacyUrl: null, downloadName: 'salida.gpx' }, ORG);
    assert.deepEqual(result, { kind: 'mismatch', key });
  });

  it('legacy: id sin forma de clave de objeto pero con URL legada', () => {
    const legacyUrl = 'https://legacy-storage.example/file/d/xyz/view';
    const result = resolveFileDownload(
      { fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', legacyUrl, downloadName: 'x' },
      ORG,
    );
    assert.deepEqual(result, { kind: 'legacy', url: legacyUrl });
  });

  it('absent: sin id y sin URL legada', () => {
    const result = resolveFileDownload({ fileId: null, legacyUrl: null, downloadName: 'x' }, ORG);
    assert.deepEqual(result, { kind: 'absent' });
  });

  it('absent: id legado sin URL legada', () => {
    const result = resolveFileDownload(
      { fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', legacyUrl: null, downloadName: 'x' },
      ORG,
    );
    assert.deepEqual(result, { kind: 'absent' });
  });
});
