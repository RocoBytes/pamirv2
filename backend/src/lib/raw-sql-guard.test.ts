// Guardia estática: el SQL crudo ($queryRaw/$executeRaw) es invisible para la
// extensión de aislamiento multi-club de lib/prisma.ts (no pasa por
// $allOperations — ver scope-args.ts), así que cada ocurrencia tiene que
// filtrar el club a mano. Este test escanea el código fuente y falla si
// aparece una ocurrencia nueva fuera de la lista permitida, o si una de las
// permitidas dejó de filtrar por "organization_id".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url)); // src/lib/.. -> src

// Cada entrada nueva acá es una decisión explícita: agregar SQL crudo en un
// archivo nuevo obliga a revisar este archivo y confirmar que el filtro por
// club está presente.
const RAW_SQL_ALLOWED_FILES = new Set(['controllers/admin.controller.ts', 'controllers/eventos-admin.controller.ts']);

// Requiere un "." inmediatamente antes (prisma.$queryRaw, tx.$queryRaw) para
// no confundir una mención en un comentario (p.ej. "// $queryRaw ...") con
// una llamada real.
const RAW_SQL_PATTERN = /\.\$(?:queryRaw|executeRaw)(?:Unsafe)?\b/g;
const LOOKAHEAD_LINES = 15;

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
      RAW_SQL_PATTERN.lastIndex = 0;
      if (!RAW_SQL_PATTERN.test(line)) return;

      if (!RAW_SQL_ALLOWED_FILES.has(relative)) {
        violations.push({
          file: relative,
          line: index + 1,
          reason: 'usa SQL crudo pero el archivo no está en RAW_SQL_ALLOWED_FILES',
        });
        return;
      }

      const window = lines.slice(index, index + LOOKAHEAD_LINES).join('\n');
      if (!window.includes('organization_id')) {
        violations.push({
          file: relative,
          line: index + 1,
          reason: `no filtra por "organization_id" en las ${LOOKAHEAD_LINES} líneas siguientes`,
        });
      }
    });
  }

  return violations;
}

describe('raw-sql-guard', () => {
  it('toda ocurrencia de $queryRaw/$executeRaw está permitida y filtra por club', () => {
    const violations = scan();
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.file}:${v.line} — ${v.reason}`).join('\n'),
    );
  });

  it('el escaneo sigue encontrando las ocurrencias reales conocidas (no se rompió en silencio)', () => {
    let occurrences = 0;
    for (const file of collectTsFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      RAW_SQL_PATTERN.lastIndex = 0;
      occurrences += content.match(RAW_SQL_PATTERN)?.length ?? 0;
    }
    assert.ok(occurrences >= RAW_SQL_ALLOWED_FILES.size, 'el escaneo no encontró las ocurrencias esperadas de SQL crudo');
  });
});
