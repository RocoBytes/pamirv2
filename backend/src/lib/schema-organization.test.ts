import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Prueba estática (lee prisma/schema.prisma como texto, sin depender de
// internals de Prisma) que evita que un modelo nuevo quede sin
// organizationId por accidente: cada tabla de negocio debe ser propiedad de
// un club. Ampliar esta lista es una decisión explícita, no un descuido.
const MODELOS_SIN_ORGANIZATION_ID = new Set(['Organization', 'AppSecret']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'schema.prisma');

function leerModelos(schema: string): { nombre: string; cuerpo: string }[] {
  const modelos: { nombre: string; cuerpo: string }[] = [];
  const regex = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(schema)) !== null) {
    modelos.push({ nombre: match[1] as string, cuerpo: match[2] as string });
  }
  return modelos;
}

describe('schema.prisma — organizationId obligatorio', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const modelos = leerModelos(schema);

  it('encuentra al menos los modelos conocidos (regresión del parser)', () => {
    const nombres = modelos.map((m) => m.nombre);
    assert.ok(nombres.includes('Organization'));
    assert.ok(nombres.includes('Salida'));
    assert.ok(nombres.length >= 16);
  });

  it('todo modelo fuera de la allowlist declara organizationId mapeado a organization_id', () => {
    const faltantes: string[] = [];
    for (const { nombre, cuerpo } of modelos) {
      if (MODELOS_SIN_ORGANIZATION_ID.has(nombre)) continue;
      const tieneOrganizationId = /organizationId\s+String\s+@map\("organization_id"\)/.test(cuerpo);
      if (!tieneOrganizationId) faltantes.push(nombre);
    }
    assert.deepEqual(faltantes, [], `Modelos sin organizationId: ${faltantes.join(', ')}`);
  });

  it('la allowlist no contiene un modelo que ya no existe en el schema', () => {
    const nombres = new Set(modelos.map((m) => m.nombre));
    for (const permitido of MODELOS_SIN_ORGANIZATION_ID) {
      assert.ok(nombres.has(permitido), `"${permitido}" está en la allowlist pero no existe en el schema`);
    }
  });
});
