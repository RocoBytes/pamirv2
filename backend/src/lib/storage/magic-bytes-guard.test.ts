import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MagicBytesGuard, INVALID_FILE_TYPE } from './magic-bytes-guard.js';

/** Pasa los chunks por el guard y devuelve lo que sale, o el error que aborta. */
async function run(chunks: (Buffer | string)[]): Promise<Buffer> {
  const salida: Buffer[] = [];
  const guard = new MagicBytesGuard();
  guard.on('data', (c: Buffer) => salida.push(c));
  await pipeline(Readable.from(chunks.map((c) => Buffer.from(c))), guard);
  return Buffer.concat(salida);
}

async function expectRejects(chunks: (Buffer | string)[]): Promise<void> {
  await assert.rejects(
    () => run(chunks),
    (err: NodeJS.ErrnoException) => {
      assert.equal(err.code, INVALID_FILE_TYPE);
      return true;
    },
  );
}

describe('MagicBytesGuard', () => {
  it('deja pasar un PDF intacto', async () => {
    const pdf = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF';
    const salida = await run([pdf]);
    assert.equal(salida.toString(), pdf);
  });

  it('rechaza contenido que no es PDF aunque el nombre lo diga', async () => {
    // El caso que motiva todo esto: un ejecutable renombrado a .pdf.
    await expectRejects(['MZ\x90\x00 esto es un binario, no un PDF']);
  });

  it('rechaza un HTML disfrazado', async () => {
    await expectRejects(['<!DOCTYPE html><html><body>no soy un pdf</body></html>']);
  });

  it('acumula cuando el primer chunk es más corto que la firma', async () => {
    // Un stream puede entregar la cabecera partida byte a byte; suponer que el
    // primer chunk trae los 5 bytes rechazaría PDFs válidos.
    const salida = await run(['%', 'P', 'D', 'F', '-1.4\ncontenido']);
    assert.equal(salida.toString(), '%PDF-1.4\ncontenido');
  });

  it('rechaza aunque la firma llegue partida si no coincide', async () => {
    await expectRejects(['%P', 'NG\r\n']);
  });

  it('rechaza un archivo vacío', async () => {
    await expectRejects([]);
  });

  it('rechaza un archivo más corto que la firma', async () => {
    await expectRejects(['%PDF']);
  });

  it('no altera el contenido de un PDF grande partido en varios chunks', async () => {
    const cuerpo = 'x'.repeat(50_000);
    const salida = await run(['%PDF-1.7\n', cuerpo, '\n%%EOF']);
    assert.equal(salida.toString(), `%PDF-1.7\n${cuerpo}\n%%EOF`);
  });
});
