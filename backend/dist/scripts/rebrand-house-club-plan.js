// Lógica pura del one-off rebrand-house-club.ts, separada del CLI para que su
// test la importe sin cargar Prisma ni ejecutar main() — mismo patrón que
// tenant-args.ts/tenant.ts y create-user-args.ts/create-user.ts.
export const OLD_SLUG = 'pamir';
export const NEW_SLUG = 'riala';
export const NEW_NAME = 'RIALA';
export const NEW_SHORT_NAME = 'RIALA';
export const NEW_MEMBRESIA_PROPIA = 'SOCIO_RIALA';
/**
 * Pura (sin Prisma ni storage): decide qué cambia dado el estado actual leído
 * de la base. Separada de main() para poder probarla sin base de datos —
 * mismo patrón que membresiaParaNuevaFicha en lib/integrante-membresia.ts.
 */
export function planRebrand({ pamirOrg, rialaExists }) {
    if (!pamirOrg) {
        return rialaExists ? { kind: 'already-applied' } : { kind: 'pamir-not-found' };
    }
    const changes = [];
    if (pamirOrg.slug !== NEW_SLUG) {
        changes.push({ campo: 'slug', antes: pamirOrg.slug, despues: NEW_SLUG });
    }
    if (pamirOrg.name !== NEW_NAME) {
        changes.push({ campo: 'name', antes: pamirOrg.name, despues: NEW_NAME });
    }
    if (pamirOrg.shortName !== NEW_SHORT_NAME) {
        changes.push({
            campo: 'shortName',
            antes: pamirOrg.shortName ?? '(sin nombre corto)',
            despues: NEW_SHORT_NAME,
        });
    }
    if (pamirOrg.membresiaPropia !== NEW_MEMBRESIA_PROPIA) {
        changes.push({ campo: 'membresiaPropia', antes: pamirOrg.membresiaPropia, despues: NEW_MEMBRESIA_PROPIA });
    }
    if (pamirOrg.logoObjectKey !== null) {
        changes.push({ campo: 'logoObjectKey', antes: pamirOrg.logoObjectKey, despues: '(borrado)' });
    }
    return { kind: 'plan', changes };
}
