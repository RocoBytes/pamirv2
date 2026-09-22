import { parseArgs } from 'node:util';
import { emailField, nameField } from '../lib/auth-fields.js';
const ROL_VALUES = ['SOCIO', 'LIDER', 'ADMIN'];
const USAGE_ERROR = 'Argumentos inválidos. Flags permitidos: --email <email>, --name "<nombre>", --rol <SOCIO|LIDER|ADMIN>, ' +
    '--org <slug>, --force. --org es requerido: ejecuta "npm run tenant:list" para ver los slugs disponibles.';
export function parseCreateUserArgs(argv) {
    let rawValues;
    try {
        const parsed = parseArgs({
            args: argv,
            options: {
                email: { type: 'string' },
                name: { type: 'string' },
                rol: { type: 'string' },
                org: { type: 'string' },
                force: { type: 'boolean', default: false },
            },
            strict: true,
            allowPositionals: false,
        });
        rawValues = parsed.values;
    }
    catch {
        return { success: false, errors: [USAGE_ERROR] };
    }
    const errors = [];
    let email;
    let name;
    if (rawValues.email === undefined) {
        errors.push('El email es requerido');
    }
    else {
        const emailResult = emailField.safeParse(rawValues.email);
        if (emailResult.success) {
            email = emailResult.data;
        }
        else {
            errors.push(emailResult.error.issues[0]?.message ?? 'Email inválido');
        }
    }
    if (rawValues.name === undefined) {
        errors.push('El nombre es requerido');
    }
    else {
        const nameResult = nameField.safeParse(rawValues.name);
        if (nameResult.success) {
            name = nameResult.data;
        }
        else {
            errors.push(nameResult.error.issues[0]?.message ?? 'Nombre inválido');
        }
    }
    const rolInput = rawValues.rol ?? 'SOCIO';
    const rol = ROL_VALUES.find((r) => r === rolInput);
    if (!rol) {
        errors.push('El rol debe ser SOCIO, LIDER o ADMIN');
    }
    const org = (rawValues.org ?? '').trim();
    if (org === '') {
        errors.push('El slug de la organización (--org) es requerido. Ejecuta "npm run tenant:list" para ver los slugs disponibles.');
    }
    if (errors.length > 0 || !email || !name || !rol || !org) {
        return { success: false, errors };
    }
    return {
        success: true,
        data: { email: email.toLowerCase(), name, rol, force: rawValues.force ?? false, org },
    };
}
