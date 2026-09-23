// One-off: convierte la organización "pamir" en el club-casa de RIALA. Hoy
// esa fila es, de hecho, la cuenta de la plataforma (rockohxc@gmail.com es su
// ADMIN) — nunca un club real: cuando el verdadero Andino Club Pamir se dé de
// alta más adelante, se crea desde cero con slug "pamir" (tenant:create), sin
// relación con esta fila.
//
// Dry-run por defecto (solo imprime el diff); "--apply" escribe. Idempotente:
// una segunda corrida (con o sin --apply) detecta que ya se aplicó y no toca
// nada. "riala" está en SLUGS_RESERVADOS (scripts/tenant-args.ts) para que el
// CLI de tenant.ts nunca lo use al crear un club nuevo — este script es la
// única vía que lo asigna, precisamente porque es quien lo libera de "pamir".
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { prisma } from '../lib/prisma.js';
import { verifyDbTargetOrExit as guardVerifyDbTargetOrExit } from '../lib/db-target-guard.js';
import { runAsPlatform } from '../lib/tenant-context.js';
import { deleteStoredFileBestEffort } from '../lib/storage/delete-best-effort.js';
import { NEW_MEMBRESIA_PROPIA, NEW_NAME, NEW_SHORT_NAME, NEW_SLUG, OLD_SLUG, planRebrand, } from './rebrand-house-club-plan.js';
// Defensa en profundidad: npm run oneoff:rebrand-house-club ya ejecuta el
// guard como pre-hook, pero este script también puede invocarse directamente
// con tsx. Mismo patrón que create-user.ts/tenant.ts.
function verifyDbTargetOrExit() {
    guardVerifyDbTargetOrExit({
        prefix: '[rebrand-house-club]',
        honorAllowAny: true,
        failureMessage: '[rebrand-house-club] Comando abortado: DATABASE_URL no coincide con la base de datos de v2 declarada en ' +
            'backend/db-target.json. Si esto corre en el contenedor de producción, define ALLOW_ANY_DB_TARGET=1.',
    });
}
function printPlan(plan) {
    if (plan.kind === 'already-applied') {
        console.log(`[rebrand-house-club] Ya aplicado: no existe una organización "${OLD_SLUG}" y "${NEW_SLUG}" ya existe.`);
        return;
    }
    if (plan.kind === 'pamir-not-found') {
        console.error(`[rebrand-house-club] No se encontró una organización con slug "${OLD_SLUG}" ni "${NEW_SLUG}". Nada que hacer.`);
        return;
    }
    if (plan.changes.length === 0) {
        console.log(`[rebrand-house-club] La organización "${OLD_SLUG}" ya tiene todos los valores objetivo.`);
        return;
    }
    console.log(`[rebrand-house-club] Cambios a aplicar sobre la organización "${OLD_SLUG}":`);
    for (const change of plan.changes) {
        console.log(`  ${change.campo}: ${change.antes} → ${change.despues}`);
    }
}
async function main() {
    verifyDbTargetOrExit();
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: { apply: { type: 'boolean', default: false } },
        strict: true,
        allowPositionals: false,
    });
    const apply = values.apply === true;
    const [pamirOrg, rialaOrg] = await Promise.all([
        prisma.organization.findUnique({
            where: { slug: OLD_SLUG },
            select: { id: true, slug: true, name: true, shortName: true, membresiaPropia: true, logoObjectKey: true },
        }),
        prisma.organization.findUnique({ where: { slug: NEW_SLUG }, select: { id: true } }),
    ]);
    const plan = planRebrand({ pamirOrg, rialaExists: rialaOrg !== null });
    printPlan(plan);
    if (plan.kind !== 'plan' || plan.changes.length === 0) {
        if (plan.kind === 'pamir-not-found')
            process.exitCode = 1;
        return;
    }
    if (!apply) {
        console.log('[rebrand-house-club] Dry-run (sin --apply): no se escribió nada.');
        return;
    }
    // pamirOrg no es null acá: plan.kind === 'plan' solo se produce con pamirOrg presente.
    const org = pamirOrg;
    if (org.logoObjectKey) {
        // Best-effort a propósito (ver el comentario de deleteStoredFileBestEffort):
        // si el objeto no existe o el storage falla, se registra y se sigue —
        // dejar logoObjectKey en null en la fila es lo que importa acá, no que el
        // borrado físico sea perfecto.
        await deleteStoredFileBestEffort(org.logoObjectKey, 'rebrandHouseClub');
    }
    const updated = await prisma.organization.update({
        where: { id: org.id },
        data: {
            slug: NEW_SLUG,
            name: NEW_NAME,
            shortName: NEW_SHORT_NAME,
            membresiaPropia: NEW_MEMBRESIA_PROPIA,
            logoObjectKey: null,
        },
        select: { id: true, slug: true, name: true, shortName: true, membresiaPropia: true, logoObjectKey: true },
    });
    console.log(`[rebrand-house-club] Aplicado: id="${updated.id}" slug="${updated.slug}" name="${updated.name}" ` +
        `shortName="${updated.shortName}" membresiaPropia="${updated.membresiaPropia}" logoObjectKey=${String(updated.logoObjectKey)}`);
}
runAsPlatform(main)
    .catch((error) => {
    console.error('[rebrand-house-club] Error inesperado:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma.$disconnect();
});
