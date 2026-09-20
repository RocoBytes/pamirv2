// Guardia previa a cualquier comando de Prisma que toque una base de datos
// real (db:push, db:deploy, db:migrate, db:studio, db:create-user). Compara el
// host de DATABASE_URL contra el fragmento declarado en backend/db-target.json
// y aborta si no coincide, para evitar que un comando local termine
// modificando accidentalmente la base de datos de producción (v1).
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { describeTarget, isAllowedTarget } from '../lib/db-target.js';

interface DbTargetConfig {
  allowedHostFragment: string;
}

function loadConfig(): DbTargetConfig {
  const raw = readFileSync(new URL('../../db-target.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as DbTargetConfig;
}

const databaseUrl = process.env.DATABASE_URL;
const config = loadConfig();
const target = describeTarget(databaseUrl ?? '');

if (target) {
  console.log(`[db-target] DATABASE_URL apunta a host="${target.host}" database="${target.database}"`);
} else {
  console.log('[db-target] DATABASE_URL no está definido o no se pudo interpretar como una URL válida.');
}

if (!isAllowedTarget(databaseUrl, config.allowedHostFragment)) {
  console.error(
    '[db-target] Comando abortado: DATABASE_URL no coincide con la base de datos de v2 declarada en ' +
      'backend/db-target.json (o el archivo todavía no tiene configurado "allowedHostFragment"). ' +
      'Confirma que DATABASE_URL apunta al proyecto Neon correcto antes de reintentar.',
  );
  process.exit(1);
}

console.log('[db-target] DATABASE_URL coincide con el destino permitido. Continuando.');
