import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  MagicBytesGuard,
  INVALID_FILE_TYPE,
  PDF_SIGNATURE,
  JPEG_SIGNATURE,
  PNG_SIGNATURE,
  XML_SIGNATURES,
  type MagicBytesGuardOptions,
} from './magic-bytes-guard.js';

const PDF_ONLY: MagicBytesGuardOptions = { signatures: [PDF_SIGNATURE] };
const GPX: MagicBytesGuardOptions = { signatures: XML_SIGNATURES, allowLeadingWhitespace: true };
const PRONOSTICO: MagicBytesGuardOptions = {
  signatures: [PDF_SIGNATURE, JPEG_SIGNATURE, PNG_SIGNATURE],
};

/** Pasa los chunks por el guard y devuelve lo que sale, o el error que aborta. */
async function run(
  chunks: (Buffer | string)[],
  options: MagicBytesGuardOptions = PDF_ONLY,
): Promise<Buffer> {
  const salida: Buffer[] = [];
  const guard = new MagicBytesGuard(options);
  guard.on('data', (c: Buffer) => salida.push(c));
  await pipeline(Readable.from(chunks.map((c) => Buffer.from(c))), guard);
  return Buffer.concat(salida);
}

async function expectRejects(
  chunks: (Buffer | string)[],
  options: MagicBytesGuardOptions = PDF_ONLY,
): Promise<void> {
  await assert.rejects(
    () => run(chunks, options),
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

describe('MagicBytesGuard — GPX (tolerante, formato de texto)', () => {
  const TRACK = '<?xml version="1.0"?>\n<gpx version="1.1"><trk></trk></gpx>';

  it('acepta un GPX con declaración XML', async () => {
    assert.equal((await run([TRACK], GPX)).toString(), TRACK);
  });

  it('acepta un GPX que abre directo con <gpx>, sin declaración', async () => {
    const sinDecl = '<gpx version="1.1"><trk></trk></gpx>';
    assert.equal((await run([sinDecl], GPX)).toString(), sinDecl);
  });

  it('acepta un BOM UTF-8 delante, que anteponen varios exportadores', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const salida = await run([Buffer.concat([bom, Buffer.from(TRACK)])], GPX)
    assert.ok(salida.toString().includes('<gpx'))
    // El BOM se conserva: el guard valida, no reescribe el archivo.
    assert.deepEqual(salida.subarray(0, 3), bom)
  });

  it('acepta saltos de línea antes de la declaración', async () => {
    const conEspacios = `\n\n  ${TRACK}`;
    assert.equal((await run([conEspacios], GPX)).toString(), conEspacios);
  });

  it('sigue rechazando un binario renombrado a .gpx', async () => {
    await expectRejects([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])], GPX); // ZIP
  });

  it('rechaza un archivo de texto que no es XML', async () => {
    await expectRejects(['lat,lon,ele\n-33.4,-70.6,800\n'], GPX);
  });
});

describe('MagicBytesGuard — pronóstico (PDF, JPEG o PNG)', () => {
  it('acepta un JPEG', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.deepEqual(await run([jpeg], PRONOSTICO), jpeg);
  });

  it('acepta un PNG', async () => {
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('IHDR')]);
    assert.deepEqual(await run([png], PRONOSTICO), png);
  });

  it('acepta un PDF', async () => {
    assert.equal((await run(['%PDF-1.7\ncontenido'], PRONOSTICO)).toString(), '%PDF-1.7\ncontenido');
  });

  it('acepta un JPEG diminuto, más corto que la firma más larga del set', async () => {
    // La ventana se dimensiona por la firma más larga (PNG, 8 bytes): un
    // archivo de 3 bytes nunca la llena y hay que decidir igual al cerrar.
    const minimo = Buffer.from([0xff, 0xd8, 0xff]);
    assert.deepEqual(await run([minimo], PRONOSTICO), minimo);
  });

  it('rechaza un GIF, que no está en el set permitido', async () => {
    await expectRejects(['GIF89a' + '\x00'.repeat(8)], PRONOSTICO);
  });

  it('rechaza un binario arbitrario', async () => {
    await expectRejects([Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])], PRONOSTICO);
  });
});
