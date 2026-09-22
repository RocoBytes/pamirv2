import { parseArgs } from 'node:util';
import { emailField, nameField } from '../lib/auth-fields.js';
const ROL_VALUES = ['SOCIO', 'LIDER', 'ADMIN'];
// Slug de la organización por defecto: el único club antes de multi-club.
const DEFAULT_ORG_SLUG = 'pamir';
const USAGE_ERROR = 'Argumentos inválidos. Flags permitidos: --email <email>, --name "<nombre>", --rol <SOCIO|LIDER|ADMIN>, --org <slug>, --force';
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
    const org = (rawValues.org ?? DEFAULT_ORG_SLUG).trim();
    if (org === '') {
        errors.push('El slug de la organización (--org) no puede estar vacío');
    }
    if (errors.length > 0 || !email || !name || !rol) {
        return { success: false, errors };
    }
    return {
        success: true,
        data: { email: email.toLowerCase(), name, rol, force: rawValues.force ?? false, org },
    };
}
