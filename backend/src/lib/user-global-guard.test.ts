// Guardia estática: mover User a GLOBAL_MODELS (ver scope-args.ts) significa
// que ya no hay ningún filtro automático por club en NINGUNA de estas
// operaciones — un prisma.user.findMany/count/groupBy/aggregate sin filtrar
// a mano por Membresia devolvería personas de TODOS los clubes. Este test
// escanea el código fuente y falla si aparece una ocurrencia nueva fuera de
// la lista permitida, o si la permitida dejó de correr dentro de
// runAsPlatform (la única forma legítima de que sea deliberadamente
// cross-club).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url)); // src/lib/.. -> src

// Cada entrada nueva acá es una decisión explícita: un listado o conteo de
// User fuera del club activo debe pasar por Membresia (ver
// controllers/admin.controller.ts, listUsers) — la única excepción legítima
// hoy es el invariante global de la suite de aislamiento (PR 1, Task 5): un
// conteo deliberadamente cross-club de usuarios sin ninguna Membresia.
const USER_LISTING_ALLOWED_FILES = new Set(['scripts/test-isolation.ts']);

// Requiere un "." inmediatamente antes (prisma.user.count, tx.user.findMany)
// para no confundir una mención en un comentario con una llamada real.
const USER_LISTING_PATTERN = /\.user\.(findMany|count|groupBy|aggregate)\b/g;
const LOOKAHEAD_LINES = 10;

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'generated') continue;
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      collectTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  reason: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];

  for (const file of collectTsFiles(SRC_DIR)) {
    const relative = path.relative(SRC_DIR, file).split(path.sep).join('/');
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      USER_LISTING_PATTERN.lastIndex = 0;
      if (!USER_LISTING_PATTERN.test(line)) return;

      if (!USER_LISTING_ALLOWED_FILES.has(relative)) {
        violations.push({
          file: relative,
          line: index + 1,
          reason: 'usa prisma.user.findMany/count/groupBy/aggregate pero el archivo no está en ' +
            'USER_LISTING_ALLOWED_FILES — lee por Membresia en su lugar',
        });
        return;
      }

      const window = lines.slice(index, index + LOOKAHEAD_LINES).join('\n');
      if (!window.includes('runAsPlatform')) {
        violations.push({
          file: relative,
          line: index + 1,
          reason: `no corre dentro de runAsPlatform en las ${LOOKAHEAD_LINES} líneas siguientes`,
        });
      }
    });
  }

  return violations;
}

describe('user-global-guard', () => {
  it('toda ocurrencia de prisma.user.findMany/count/groupBy/aggregate está permitida y es deliberadamente cross-club', () => {
    const violations = scan();
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.file}:${v.line} — ${v.reason}`).join('\n'),
    );
  });

  it('el escaneo sigue encontrando la ocurrencia real conocida (no se rompió en silencio)', () => {
    let occurrences = 0;
    for (const file of collectTsFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      USER_LISTING_PATTERN.lastIndex = 0;
      occurrences += content.match(USER_LISTING_PATTERN)?.length ?? 0;
    }
    assert.ok(occurrences >= USER_LISTING_ALLOWED_FILES.size, 'el escaneo no encontró la ocurrencia esperada');
  });
});
