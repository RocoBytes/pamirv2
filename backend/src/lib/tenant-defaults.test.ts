import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CATEGORIAS_EVENTO,
  DEFAULT_DECLARACION_ITEMS,
  DEFAULT_DECLARACION_TITULO,
  computeDeclaracionHash,
  buildDefaultDeclaracion,
} from './tenant-defaults.js';

describe('DEFAULT_CATEGORIAS_EVENTO', () => {
  it('tiene 6 categorías con slugs únicos', () => {
    const slugs = DEFAULT_CATEGORIAS_EVENTO.map((c) => c.slug);
    assert.equal(slugs.length, 6);
    assert.equal(new Set(slugs).size, 6);
  });

  it('tiene un orden contiguo de 1 a 6', () => {
    const ordenes = DEFAULT_CATEGORIAS_EVENTO.map((c) => c.orden).sort((a, b) => a - b);
    assert.deepEqual(ordenes, [1, 2, 3, 4, 5, 6]);
  });

  it('todas están activas', () => {
    assert.ok(DEFAULT_CATEGORIAS_EVENTO.every((c) => c.activa === true));
  });
});

describe('computeDeclaracionHash', () => {
  it('reproduce el hash_sha256 grabado en la migración 20260822120000_add_eventos_module', () => {
    // Literal copiado tal cual de esa migración: prueba que la fórmula
    // documentada (sha256(titulo + '\n' + items.join('\n'))) es la correcta,
    // en vez de asumirlo.
    const HASH_ESPERADO = '8f001039739a22d932b6fdce1ce55bbb945fe635547777b17a6e4c42d2fa37fc';
    const hash = computeDeclaracionHash(DEFAULT_DECLARACION_TITULO, DEFAULT_DECLARACION_ITEMS);
    assert.equal(hash, HASH_ESPERADO);
  });

  it('cambia si un ítem cambia', () => {
    const base = computeDeclaracionHash('titulo', ['a', 'b']);
    const modificado = computeDeclaracionHash('titulo', ['a', 'c']);
    assert.notEqual(base, modificado);
  });
});

describe('buildDefaultDeclaracion', () => {
  it('devuelve la versión, título e items por defecto sin importar el nombre del club', () => {
    const clubA = buildDefaultDeclaracion({ name: 'Club de Montaña A' });
    const clubB = buildDefaultDeclaracion({ name: 'Otro Club B' });

    assert.equal(clubA.version, '2026-08');
    assert.equal(clubA.titulo, DEFAULT_DECLARACION_TITULO);
    assert.deepEqual(clubA.items, DEFAULT_DECLARACION_ITEMS);
    // Byte-idéntico entre clubes: el texto no nombra a ningún club, así que el
    // nombre del club no debe alterar ni el texto ni el hash resultante.
    assert.deepEqual(clubA, clubB);
  });

  it('el hash devuelto coincide con computeDeclaracionHash sobre el mismo texto', () => {
    const declaracion = buildDefaultDeclaracion({ name: 'Cualquier Club' });
    assert.equal(declaracion.hashSha256, computeDeclaracionHash(declaracion.titulo, declaracion.items));
  });
});
