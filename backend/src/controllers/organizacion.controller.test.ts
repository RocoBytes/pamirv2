import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// El controlador importa src/lib/prisma.ts, que lanza al importarse si falta
// DATABASE_URL. No se abre ninguna conexión: estas pruebas solo ejercitan las
// funciones puras, pero el módulo igual se carga entero.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

const { ALLOWED_LOGO_EXT, contentTypeForLogo } = await import('./organizacion.controller.js');

describe('ALLOWED_LOGO_EXT', () => {
  for (const ok of ['logo.png', 'logo.jpg', 'logo.jpeg', 'LOGO.PNG', 'mi logo.JPG']) {
    it(`acepta "${ok}"`, () => {
      assert.equal(ALLOWED_LOGO_EXT.test(ok), true);
    });
  }

  for (const bad of ['logo.svg', 'logo.pdf', 'logo.gif', 'logo', 'logo.png.svg']) {
    it(`rechaza "${bad}" (SVG queda fuera a propósito)`, () => {
      assert.equal(ALLOWED_LOGO_EXT.test(bad), false);
    });
  }
});

describe('contentTypeForLogo', () => {
  it('png → image/png', () => {
    assert.equal(contentTypeForLogo('png'), 'image/png');
  });

  it('jpg → image/jpeg', () => {
    assert.equal(contentTypeForLogo('jpg'), 'image/jpeg');
  });

  it('jpeg → image/jpeg', () => {
    assert.equal(contentTypeForLogo('jpeg'), 'image/jpeg');
  });
});
