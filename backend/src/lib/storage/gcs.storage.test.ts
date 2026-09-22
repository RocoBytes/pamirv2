import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createGcsStorage, type GcsBucketLike, type GcsFileLike } from './gcs.storage.js';

function streamOf(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

class FakeFile implements GcsFileLike {
  chunks: Buffer[] = [];
  writeStreamOptions: { resumable: boolean; contentType: string } | undefined;
  signedUrlOptions: Parameters<GcsFileLike['getSignedUrl']>[0] | undefined;
  deleteCalls: Array<{ ignoreNotFound?: boolean } | undefined> = [];

  constructor(public readonly key: string) {}

  createWriteStream(options: { resumable: boolean; contentType: string }): NodeJS.WritableStream {
    this.writeStreamOptions = options;
    const chunks = this.chunks;
    return new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    });
  }

  async getSignedUrl(options: Parameters<GcsFileLike['getSignedUrl']>[0]): Promise<[string]> {
    this.signedUrlOptions = options;
    return [`https://fake.storage.example/${this.key}`];
  }

  async delete(options?: { ignoreNotFound?: boolean }): Promise<unknown> {
    this.deleteCalls.push(options);
    return [{}];
  }
}

class FakeBucket implements GcsBucketLike {
  files = new Map<string, FakeFile>();

  file(key: string): FakeFile {
    let f = this.files.get(key);
    if (!f) {
      f = new FakeFile(key);
      this.files.set(key, f);
    }
    return f;
  }

  async getFiles(options: { prefix: string }): Promise<[GcsFileLike[], ...unknown[]]> {
    const matches = [...this.files.values()].filter((f) => f.key.startsWith(options.prefix));
    return [matches];
  }
}

function buildStorage(): { storage: ReturnType<typeof createGcsStorage>; bucket: FakeBucket } {
  const bucket = new FakeBucket();
  const storage = createGcsStorage({
    bucket: 'a-bucket',
    projectId: 'a-project',
    credentials: { client_email: 'sa@example.com', private_key: 'fake-key' },
    client: { bucket: () => bucket },
  });
  return { storage, bucket };
}

describe('createGcsStorage', () => {
  it('upload canaliza a través del SizeGuard y pasa resumable/contentType', async () => {
    const { storage, bucket } = buildStorage();
    await storage.upload(streamOf('contenido'), { key: 'orgs/a/gpx/1.gpx', contentType: 'application/gpx+xml', maxBytes: 1024 });

    const file = bucket.file('orgs/a/gpx/1.gpx');
    assert.deepEqual(file.writeStreamOptions, { resumable: true, contentType: 'application/gpx+xml' });
    assert.equal(Buffer.concat(file.chunks).toString(), 'contenido');
  });

  it('rechaza un upload que excede maxBytes y limpia el objeto parcial', async () => {
    const { storage, bucket } = buildStorage();
    await assert.rejects(
      () =>
        storage.upload(streamOf('contenido-demasiado-largo'), {
          key: 'orgs/a/documento/1.pdf',
          contentType: 'application/pdf',
          maxBytes: 4,
        }),
      (err: unknown) => (err as NodeJS.ErrnoException).code === 'FILE_TOO_LARGE',
    );

    const file = bucket.file('orgs/a/documento/1.pdf');
    assert.equal(file.deleteCalls.length, 1);
    assert.deepEqual(file.deleteCalls[0], { ignoreNotFound: true });
  });

  it('createSignedDownloadUrl arma versión v4, acción read, ventana de expiración y disposition', async () => {
    const { storage, bucket } = buildStorage();
    const before = Date.now();
    const url = await storage.createSignedDownloadUrl('orgs/a/gpx/1.gpx', {
      expiresInSeconds: 600,
      downloadName: 'mi salida.gpx',
    });
    const after = Date.now();

    assert.equal(url, 'https://fake.storage.example/orgs/a/gpx/1.gpx');
    const opts = bucket.file('orgs/a/gpx/1.gpx').signedUrlOptions;
    assert.equal(opts?.version, 'v4');
    assert.equal(opts?.action, 'read');
    assert.equal(opts?.responseDisposition, 'attachment; filename="mi salida.gpx"');
    assert.ok(opts!.expires >= before + 600_000 && opts!.expires <= after + 600_000);
  });

  it('sanea el nombre de descarga contra inyección de cabecera', async () => {
    const { storage, bucket } = buildStorage();
    await storage.createSignedDownloadUrl('orgs/a/gpx/1.gpx', {
      expiresInSeconds: 60,
      downloadName: 'evil"\r\nX-Injected: 1',
    });
    const opts = bucket.file('orgs/a/gpx/1.gpx').signedUrlOptions;
    assert.equal(opts?.responseDisposition.includes('\r'), false);
    assert.equal(opts?.responseDisposition.includes('\n'), false);
  });

  it('delete es idempotente (ignoreNotFound)', async () => {
    const { storage, bucket } = buildStorage();
    await storage.delete('orgs/a/gpx/1.gpx');
    await storage.delete('orgs/a/gpx/1.gpx');
    const file = bucket.file('orgs/a/gpx/1.gpx');
    assert.equal(file.deleteCalls.length, 2);
    for (const call of file.deleteCalls) {
      assert.deepEqual(call, { ignoreNotFound: true });
    }
  });

  it('deleteByPrefix borra solo los objetos bajo ese prefijo', async () => {
    const { storage, bucket } = buildStorage();
    bucket.file('orgs/a/gpx/1.gpx');
    bucket.file('orgs/a/gpx/2.gpx');
    bucket.file('orgs/b/gpx/3.gpx');

    await storage.deleteByPrefix('orgs/a/');

    assert.equal(bucket.file('orgs/a/gpx/1.gpx').deleteCalls.length, 1);
    assert.equal(bucket.file('orgs/a/gpx/2.gpx').deleteCalls.length, 1);
    assert.equal(bucket.file('orgs/b/gpx/3.gpx').deleteCalls.length, 0);
  });

  it('deleteByPrefix rechaza un prefijo vacío o mal formado en vez de arriesgar el bucket completo', async () => {
    const { storage } = buildStorage();
    for (const bad of ['', 'orgs/', '/', 'orgs/../']) {
      await assert.rejects(() => storage.deleteByPrefix(bad));
    }
  });
});
