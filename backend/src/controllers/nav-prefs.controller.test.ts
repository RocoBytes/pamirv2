import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// El controlador importa src/lib/prisma.ts, que lanza al importarse si falta
// DATABASE_URL. No se abre ninguna conexión: estas pruebas solo ejercitan la
// función pura, pero el módulo igual se carga entero.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-not-used-for-real-auth-0000';

const { sanitizeNavPreferences } = await import('./nav-prefs.controller.js');

describe('sanitizeNavPreferences — acceso a emergencias', () => {
  it('repone "contactos" cuando el cliente lo omite', () => {
    const out = sanitizeNavPreferences({ tabs: ['inicio', 'eventos'], quick: [] });
    assert.ok(out.tabs.includes('contactos'), 'el acceso a emergencias no puede faltar');
  });

  it('repone "inicio" cuando el cliente lo omite', () => {
    const out = sanitizeNavPreferences({ tabs: ['eventos'], quick: [] });
    assert.ok(out.tabs.includes('inicio'));
  });

  it('con una lista vacía deja igual los dos destinos fijos', () => {
    const out = sanitizeNavPreferences({ tabs: [], quick: [] });
    assert.deepEqual(out.tabs, ['inicio', 'contactos']);
  });

  it('no los duplica si ya venían', () => {
    const out = sanitizeNavPreferences({ tabs: ['contactos', 'inicio'], quick: [] });
    assert.deepEqual(out.tabs, ['contactos', 'inicio']);
  });
});

describe('sanitizeNavPreferences — saneado', () => {
  it('descarta claves desconocidas en vez de guardarlas', () => {
    const out = sanitizeNavPreferences({
      tabs: ['inicio', 'rutas', 'contactos'],
      quick: ['eventos', '../../etc/passwd'],
    });
    assert.deepEqual(out.tabs, ['inicio', 'contactos']);
    assert.deepEqual(out.quick, ['eventos']);
  });

  it('elimina repetidos conservando la primera aparición', () => {
    const out = sanitizeNavPreferences({
      tabs: ['eventos', 'eventos', 'inicio', 'contactos'],
      quick: ['admin', 'admin', 'invitar'],
    });
    assert.deepEqual(out.tabs, ['eventos', 'inicio', 'contactos']);
    assert.deepEqual(out.quick, ['admin', 'invitar']);
  });

  it('respeta el orden que pidió el usuario', () => {
    const out = sanitizeNavPreferences({
      tabs: ['contactos', 'documentos', 'inicio'],
      quick: ['integrante', 'contactos', 'eventos'],
    });
    assert.deepEqual(out.tabs, ['contactos', 'documentos', 'inicio']);
    assert.deepEqual(out.quick, ['integrante', 'contactos', 'eventos']);
  });

  it('no inventa accesos rápidos: una lista vacía queda vacía', () => {
    // A diferencia de las pestañas, acá no hay nada fijo — los accesos rápidos
    // son atajos, y el usuario puede quedarse sin ninguno.
    const out = sanitizeNavPreferences({ tabs: ['inicio', 'contactos'], quick: [] });
    assert.deepEqual(out.quick, []);
  });
});
