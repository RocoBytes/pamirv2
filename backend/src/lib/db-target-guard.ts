// Guardia compartida por los scripts que pueden tocar la base de datos real
// (create-user, assert-db-target, test-isolation): compara el host de
// DATABASE_URL contra el fragmento declarado en backend/db-target.json y
// aborta el proceso si no coincide, para evitar que un comando local termine
// modificando accidentalmente otra base de datos. Cada llamador conserva su
// propio prefijo de log y su propio mensaje de error (no todos comparten el
// mismo texto ni el mismo comportamiento frente a ALLOW_ANY_DB_TARGET).
import { readFileSync } from 'node:fs';
import { describeTarget, isAllowedTarget } from './db-target.js';

interface DbTargetConfig {
  allowedHostFragment: string;
}

function loadDbTargetConfig(): DbTargetConfig {
  const raw = readFileSync(new URL('../../db-target.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as DbTargetConfig;
}

export interface VerifyDbTargetOptions {
  // Etiqueta antepuesta a la línea que reporta el host/base detectados.
  prefix: string;
  // Solo create-user.ts lo activa: permite saltarse la guardia completa con
  // ALLOW_ANY_DB_TARGET=1 (contenedor de producción, donde backend/db-target.json
  // no aplica). Los demás llamadores siempre corren la verificación.
  honorAllowAny?: boolean;
  // Se invoca cuando describeTarget no pudo interpretar DATABASE_URL.
  onMissingTarget?: () => void;
  // Mensaje de error exacto a imprimir (con console.error) antes de abortar.
  failureMessage: string;
  // Se invoca solo si la verificación pasó.
  onSuccess?: () => void;
}

export function verifyDbTargetOrExit(options: VerifyDbTargetOptions): void {
  if (options.honorAllowAny && process.env.ALLOW_ANY_DB_TARGET === '1') {
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const config = loadDbTargetConfig();
  const target = describeTarget(databaseUrl ?? '');
  if (target) {
    console.log(`${options.prefix} DATABASE_URL apunta a host="${target.host}" database="${target.database}"`);
  } else {
    options.onMissingTarget?.();
  }

  if (!isAllowedTarget(databaseUrl, config.allowedHostFragment)) {
    console.error(options.failureMessage);
    process.exit(1);
  }

  options.onSuccess?.();
}
