import { emailField } from './auth-fields.js';

// Fuente única de configuración compartida por varios módulos (antes cada
// archivo declaraba su propio `FRONTEND_URL` con el mismo valor por defecto).

// URL pública del frontend, usada en los links de los correos (verificación,
// restablecimiento de contraseña, invitaciones, evaluaciones, eventos, etc.)
export const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// Remitentes fijos de correo transaccional, uno por TIPO de correo — nunca
// por club ni por actividad (la identidad del club va en el nombre visible,
// ver lib/email/club-email.ts). Agregar un tipo nuevo en el futuro (p. ej.
// "invitacion") es agregar UNA entrada acá: ningún llamador ni club-email.ts
// cambian.
const MAIL_SENDER_DEFS = {
  notificacion: { envVar: 'MAIL_FROM_NOTIFICACIONES', fallback: 'notificaciones@riala.cl' },
  alerta: { envVar: 'MAIL_FROM_ALERTAS', fallback: 'alertas@riala.cl' },
} as const;

export type EmailKind = keyof typeof MAIL_SENDER_DEFS;

// Pura (nunca lee process.env directamente, recibe el entorno como parámetro
// para poder probarla sin mutar variables globales): resuelve cada tipo de
// correo a su dirección remitente. Un valor vacío o en blanco cae al valor
// por defecto; uno presente pero inválido detiene el arranque (ver MAIL_FROM
// más abajo) en vez de dejar un correo salir desde una dirección rota.
export function resolveMailFrom(env: Record<string, string | undefined>): Record<EmailKind, string> {
  const result = {} as Record<EmailKind, string>;

  for (const kind of Object.keys(MAIL_SENDER_DEFS) as EmailKind[]) {
    const def = MAIL_SENDER_DEFS[kind];
    const raw = env[def.envVar]?.trim();
    const candidate = raw ? raw : def.fallback;

    const parsed = emailField.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(`${def.envVar} no es una dirección de correo válida`);
    }

    result[kind] = parsed.data;
  }

  return result;
}

// Evaluado al importar el módulo: una dirección remitente inválida detiene el
// arranque del proceso en vez de fallar silenciosamente en el primer envío.
export const MAIL_FROM: Record<EmailKind, string> = resolveMailFrom(process.env);
