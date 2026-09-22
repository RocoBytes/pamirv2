import { randomUUID } from 'node:crypto';
// Proveedor para desarrollo y pruebas: nunca abre una conexión de red.
// Registra un resumen de cabeceras (nunca el HTML, que puede llevar datos de
// salud u otra información sensible) y devuelve un id sintético para que el
// resto del flujo (idempotencia, columna proveedorId) se comporte igual que
// con un proveedor real.
export function createConsoleProvider() {
    return {
        send(message) {
            console.log(`[email:console] from=${message.from} to=${message.to} subject=${message.subject}`);
            return Promise.resolve({ id: `console-${randomUUID()}` });
        },
    };
}
