// Guardia pura (sin I/O, sin Prisma) para evitar que el DATABASE_URL de v2
// apunte accidentalmente a la base de datos de producción de v1. Solo describe
// el host y el nombre de la base; nunca expone usuario ni contraseña.
export function describeTarget(databaseUrl) {
    try {
        const url = new URL(databaseUrl);
        return { host: url.hostname, database: url.pathname.replace(/^\//, '') };
    }
    catch {
        return null;
    }
}
// Falla cerrado: solo permite cuando el host contiene el fragmento indicado.
// El fragmento se compara únicamente contra el host (nunca contra la URL
// completa), para que no baste con que aparezca en la contraseña o el path.
export function isAllowedTarget(databaseUrl, fragment) {
    const trimmedFragment = fragment?.trim();
    if (!databaseUrl || !trimmedFragment) {
        return false;
    }
    const target = describeTarget(databaseUrl);
    if (!target) {
        return false;
    }
    return target.host.includes(trimmedFragment);
}
