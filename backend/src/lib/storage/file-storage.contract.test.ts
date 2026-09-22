import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createMemoryStorage } from './memory.storage.js';
import { buildObjectKey, organizationPrefix } from './object-key.js';

// Ejercita el contrato del puerto FileStorage (lib/storage/file-storage.ts)
// contra el adaptador de memoria. Cualquier adaptador nuevo debería poder
// pasar el mismo contrato sin cambiar este archivo.

function streamOf(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

describe('FileStorage — contrato (adaptador de memoria)', () => {
  it('upload → signed url → delete → borrar de nuevo no falla', async () => {
    const storage = createMemoryStorage();
    const key = buildObjectKey({ organizationId: 'org-aaaaaaaa', kind: 'gpx', extension: 'gpx' });

    await storage.upload(streamOf('contenido'), { key, contentType: 'application/gpx+xml', maxBytes: 1024 });
    assert.equal(storage.has(key), true);

    const url = await storage.createSignedDownloadUrl(key, { expiresInSeconds: 600, downloadName: 'salida.gpx' });
    assert.ok(url.length > 0);

    await storage.delete(key);
    assert.equal(storage.has(key), false);
    await assert.doesNotReject(() => storage.delete(key));
  });

  it('deleteByPrefix solo borra los objetos del club indicado', async () => {
    const storage = createMemoryStorage();
    const orgA = 'org-aaaaaaaa';
    const orgB = 'org-bbbbbbbb';
    const keyA = buildObjectKey({ organizationId: orgA, kind: 'gpx', extension: 'gpx' });
    const keyB = buildObjectKey({ organizationId: orgB, kind: 'gpx', extension: 'gpx' });

    await storage.upload(streamOf('a'), { key: keyA, contentType: 'application/gpx+xml', maxBytes: 1024 });
    await storage.upload(streamOf('b'), { key: keyB, contentType: 'application/gpx+xml', maxBytes: 1024 });

    await storage.deleteByPrefix(organizationPrefix(orgB));

    assert.equal(storage.has(keyA), true);
    assert.equal(storage.has(keyB), false);
  });

  it('readMetadata/createReadStream: ida y vuelta, y clave inexistente da null', async () => {
    const storage = createMemoryStorage();
    const key = buildObjectKey({ organizationId: 'org-ddddddd', kind: 'logo', extension: 'png' });

    await storage.upload(streamOf('bytes-del-logo'), { key, contentType: 'image/png', maxBytes: 1024 });

    const metadata = await storage.readMetadata(key);
    assert.equal(metadata?.contentType, 'image/png');
    assert.equal(metadata?.size, Buffer.from('bytes-del-logo').length);
    assert.ok(metadata?.etag && metadata.etag.length > 0);

    const chunks: Buffer[] = [];
    for await (const chunk of storage.createReadStream(key)) chunks.push(chunk as Buffer);
    assert.equal(Buffer.concat(chunks).toString(), 'bytes-del-logo');

    assert.equal(await storage.readMetadata('orgs/otro/logo/no-existe.png'), null);
  });

  it('rechaza un upload que excede maxBytes y no deja rastro', async () => {
    const storage = createMemoryStorage();
    const key = buildObjectKey({ organizationId: 'org-ccccccc', kind: 'documento', extension: 'pdf' });

    await assert.rejects(
      () =>
        storage.upload(streamOf('contenido-demasiado-largo-para-el-limite'), {
          key,
          contentType: 'application/pdf',
          maxBytes: 4,
        }),
      (err: unknown) => (err as NodeJS.ErrnoException).code === 'FILE_TOO_LARGE',
    );
    assert.equal(storage.has(key), false);
  });
});
