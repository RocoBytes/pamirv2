// Guardia previa a cualquier comando de Prisma que toque una base de datos
// real (db:push, db:deploy, db:migrate, db:studio, db:create-user). Compara el
// host de DATABASE_URL contra el fragmento declarado en backend/db-target.json
// y aborta si no coincide, para evitar que un comando local termine
// modificando accidentalmente la base de datos de producción (v1).
import 'dotenv/config';
import { verifyDbTargetOrExit } from '../lib/db-target-guard.js';

verifyDbTargetOrExit({
  prefix: '[db-target]',
  onMissingTarget: () =>
    console.log('[db-target] DATABASE_URL no está definido o no se pudo interpretar como una URL válida.'),
  failureMessage:
    '[db-target] Comando abortado: DATABASE_URL no coincide con la base de datos de v2 declarada en ' +
    'backend/db-target.json (o el archivo todavía no tiene configurado "allowedHostFragment"). ' +
    'Confirma que DATABASE_URL apunta al proyecto Neon correcto antes de reintentar.',
  onSuccess: () => console.log('[db-target] DATABASE_URL coincide con el destino permitido. Continuando.'),
});
