import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SizeGuard } from './size-guard.js';

async function collect(source: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(
    source,
    new SizeGuard(maxBytes),
    new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    }),
  );
  return Buffer.concat(chunks);
}

describe('SizeGuard', () => {
  it('deja pasar un stream que no supera el límite', async () => {
    const result = await collect(Readable.from([Buffer.from('hola')]), 100);
    assert.equal(result.toString(), 'hola');
  });

  it('deja pasar un stream que llega exactamente al límite', async () => {
    const result = await collect(Readable.from([Buffer.from('abcd')]), 4);
    assert.equal(result.toString(), 'abcd');
  });

  it('rechaza un stream que supera el límite en un solo chunk', async () => {
    await assert.rejects(
      () => collect(Readable.from([Buffer.alloc(10, 'a')]), 5),
      (err: unknown) => (err as NodeJS.ErrnoException).code === 'FILE_TOO_LARGE',
    );
  });

  it('rechaza justo al cruzar el límite acumulado entre varios chunks', async () => {
    const chunks = [Buffer.alloc(3, 'a'), Buffer.alloc(3, 'b')];
    await assert.rejects(
      () => collect(Readable.from(chunks), 4),
      (err: unknown) => (err as NodeJS.ErrnoException).code === 'FILE_TOO_LARGE',
    );
  });
});
