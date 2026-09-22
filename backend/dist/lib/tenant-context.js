// Contexto de club (tenant) para el aislamiento multi-club. Toda consulta a la
// base de datos corre dentro de uno de dos estados explícitos —nunca "sin
// estado"—: el contexto de un club (`org`) o el contexto de plataforma
// (`platform`, ve todos los clubes). scope-args.ts falla cerrado cuando no hay
// ningún contexto activo: una consulta sin contexto es un bug, no un caso a
// tolerar en silencio.
import { AsyncLocalStorage } from 'node:async_hooks';
export class TenantContextError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TenantContextError';
    }
}
// TenantStore | undefined (en vez de solo TenantStore) para poder forzar
// explícitamente "sin contexto" desde bindTenantContext con storage.run(),
// sin depender de una API experimental como AsyncLocalStorage.exit().
const storage = new AsyncLocalStorage();
/** Contexto de tenant activo, o `undefined` si no se está ejecutando dentro de uno. */
export function getTenantStore() {
    return storage.getStore();
}
function isThenable(value) {
    return ((typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        typeof value.then === 'function');
}
// Las promesas de Prisma son PEREZOSAS: la consulta —y la extensión que lee este
// contexto— no corre al llamar `prisma.modelo.operacion()`, sino cuando alguien
// invoca `.then()` (es decir, al hacer `await`). Si `fn` devuelve esa promesa
// sin esperarla, el `await` de quien llama ocurre FUERA de `storage.run()` y la
// consulta correría sin contexto. Por eso, cuando `fn` devuelve un thenable, se
// dispara su `.then()` aquí mismo, de forma síncrona y dentro del contexto. Así
// `runAsPlatform(() => prisma.user.findUnique(...))` es seguro aunque la
// función no sea `async`.
function runInStore(store, fn) {
    return storage.run(store, () => {
        const result = fn();
        if (!isThenable(result)) {
            return result;
        }
        return new Promise((resolve, reject) => {
            result.then(resolve, reject);
        });
    });
}
/** Ejecuta `fn` dentro del contexto de un club específico. */
export function runWithOrganization(organizationId, fn) {
    return runInStore({ kind: 'org', organizationId }, fn);
}
// Solo para flujos explícitamente cross-club (login, verificación de token,
// scripts administrativos): ve todos los clubes sin filtrar. Su uso está
// restringido por ESLint a una lista corta de archivos — ver eslint.config.mjs.
export function runAsPlatform(fn) {
    return runInStore({ kind: 'platform' }, fn);
}
/** El organizationId del contexto activo. Lanza fuera de un contexto de club (incluido el de plataforma). */
export function requireOrganizationId() {
    const store = storage.getStore();
    if (!store || store.kind !== 'org') {
        throw new TenantContextError('Se requiere un contexto de club (runWithOrganization) para esta operación y no hay ninguno activo.');
    }
    return store.organizationId;
}
/**
 * Captura el contexto de tenant VIGENTE en el momento de la llamada y devuelve
 * una función que, al invocarse (posiblemente más tarde y fuera de cualquier
 * contexto — por ejemplo desde un listener de EventEmitter como busboy), corre
 * `fn` dentro de ese contexto capturado. Implementado con `getStore()` +
 * `run()` en vez de una API experimental de Node (p.ej. AsyncResource.bind).
 *
 * Siempre envuelve con `storage.run(...)`, incluso cuando lo capturado fue
 * "sin contexto" (`undefined`): así el handler nunca hereda por accidente el
 * contexto que esté vigente en el momento de la invocación (que podría ser
 * distinto al que había en el momento de capturar).
 */
export function bindTenantContext(fn) {
    const capturedStore = storage.getStore();
    return (...args) => runInStore(capturedStore, () => fn(...args));
}
