import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// El controlador importa src/lib/prisma.ts, que lanza al importarse si falta
// DATABASE_URL. No se abre ninguna conexión: estas pruebas solo ejercitan las
// funciones puras, pero el módulo igual se carga entero.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

const { quoteEtag, etagMatches } = await import('./clubes.controller.js');

describe('quoteEtag', () => {
  it('agrega comillas al etag opaco que devuelve GCS', () => {
    assert.equal(quoteEtag('CJDf2vLm'), '"CJDf2vLm"');
  });

  it('no vuelve a comillar uno que ya las tiene', () => {
    assert.equal(quoteEtag('"CJDf2vLm"'), '"CJDf2vLm"');
    assert.equal(quoteEtag('W/"CJDf2vLm"'), 'W/"CJDf2vLm"');
  });
});

describe('etagMatches', () => {
  it('sin cabecera If-None-Match no hay coincidencia', () => {
    assert.equal(etagMatches(undefined, '"abc"'), false);
    assert.equal(etagMatches('', '"abc"'), false);
  });

  it('coincide con el mismo etag', () => {
    assert.equal(etagMatches('"abc"', '"abc"'), true);
  });

  // Cloudflare (y otros intermediarios) pueden debilitar el validador: para
  // una imagen inmutable, W/"abc" y "abc" significan lo mismo.
  it('tolera el prefijo W/ en cualquiera de los dos lados', () => {
    assert.equal(etagMatches('W/"abc"', '"abc"'), true);
    assert.equal(etagMatches('"abc"', 'W/"abc"'), true);
  });

  it('acepta una lista separada por comas', () => {
    assert.equal(etagMatches('"otro", W/"abc"', '"abc"'), true);
    assert.equal(etagMatches('"otro", "tercero"', '"abc"'), false);
  });

  it('no coincide con un etag distinto', () => {
    assert.equal(etagMatches('"abc"', '"xyz"'), false);
  });
});
