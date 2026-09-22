import { createSmtpProvider } from './smtp.provider.js';
import { createConsoleProvider } from './console.provider.js';
import { MAIL_ACCOUNTS } from '../config.js';
import type { EmailKind } from '../config.js';
import type { EmailProvider } from './email-provider.js';

export type EmailProviderName = 'smtp' | 'console';

export interface SelectEmailProviderParams {
  emailProvider: string | undefined;
  smtpHost: string | undefined;
  smtpPort: string | undefined;
  smtpUser: string | undefined;
  smtpPass: string | undefined;
  nodeEnv: string | undefined;
}

export interface ParsedSmtpEnv {
  host: string;
  port: number;
  user: string;
  pass: string;
}

// El error solo nombra las variables faltantes o inválidas, nunca sus
// valores, para que un log de arranque no filtre credenciales.
function assertSmtpEnv(params: SelectEmailProviderParams): ParsedSmtpEnv {
  const missing: string[] = [];
  if (!params.smtpHost) missing.push('SMTP_HOST');
  if (!params.smtpUser) missing.push('SMTP_USER');
  if (!params.smtpPass) missing.push('SMTP_PASS');

  const port = params.smtpPort ? Number(params.smtpPort) : NaN;
  const portValido = Number.isInteger(port) && port >= 1 && port <= 65535;
  if (!portValido) missing.push('SMTP_PORT');

  if (missing.length > 0) {
    throw new Error(`Configuración SMTP incompleta o inválida: falta(n) ${missing.join(', ')}`);
  }

  return { host: params.smtpHost as string, port, user: params.smtpUser as string, pass: params.smtpPass as string };
}

// Pura (sin process.env, sin red): decide qué proveedor corresponde usar.
// EMAIL_PROVIDER explícito manda; si no está definido, se usa SMTP cuando hay
// SMTP_HOST y "console" en caso contrario. Si el proveedor resuelto es SMTP,
// exige el resto de las variables de conexión (ver assertSmtpEnv). "console"
// nunca es válido en producción: un servidor que solo registra en el log las
// alarmas de seguridad en vez de enviarlas es inaceptable.
export function selectEmailProvider(params: SelectEmailProviderParams): EmailProviderName {
  const explicit = params.emailProvider?.trim().toLowerCase();

  if (explicit && explicit !== 'smtp' && explicit !== 'console') {
    throw new Error(`EMAIL_PROVIDER="${explicit}" no es un proveedor de correo reconocido`);
  }

  const resolved: EmailProviderName =
    explicit === 'smtp' ? 'smtp' : explicit === 'console' ? 'console' : params.smtpHost ? 'smtp' : 'console';

  if (resolved === 'smtp') {
    assertSmtpEnv(params);
  }

  if (resolved === 'console' && params.nodeEnv === 'production') {
    throw new Error(
      'No se puede usar el proveedor de correo "console" en producción: un servidor que solo registra las ' +
        'alarmas de seguridad en el log en vez de enviarlas es inaceptable.',
    );
  }

  return resolved;
}

export interface ProviderConnectionCache {
  byConnection: Map<string, EmailProvider>;
}

export function createProviderConnectionCache(): ProviderConnectionCache {
  return { byConnection: new Map() };
}

export interface ProviderFactories {
  smtp: (params: ParsedSmtpEnv) => EmailProvider;
  console: () => EmailProvider;
}

const defaultFactories: ProviderFactories = { smtp: createSmtpProvider, console: createConsoleProvider };

// Identifica una conexión SMTP por host+puerto+usuario: dos tipos de correo
// que resuelven a la misma cuenta (p. ej. porque ninguno define su par propio
// y ambos caen al SMTP_USER/SMTP_PASS global) comparten la MISMA conexión en
// vez de abrir un segundo pool para exactamente la misma cuenta.
function connectionKey(params: ParsedSmtpEnv): string {
  return `${params.host}:${params.port}:${params.user}`;
}

// Pura salvo por la caché y las fábricas, ambas inyectables (los tests nunca
// abren una conexión real): decide y crea (o reutiliza) el proveedor para una
// cuenta ya resuelta. Separada de getEmailProvider para poder probar la
// reutilización de conexión sin depender de process.env ni de memoización a
// nivel de módulo.
export function resolveEmailProvider(
  params: SelectEmailProviderParams,
  cache: ProviderConnectionCache,
  factories: ProviderFactories = defaultFactories,
): EmailProvider {
  const name = selectEmailProvider(params);
  if (name === 'console') return factories.console();

  const parsed = assertSmtpEnv(params);
  const key = connectionKey(parsed);
  const existing = cache.byConnection.get(key);
  if (existing) return existing;

  const created = factories.smtp(parsed);
  cache.byConnection.set(key, created);
  return created;
}

// Arma los parámetros de selección para UN tipo de correo, a partir de la
// cuenta ya resuelta por tipo (ver MAIL_ACCOUNTS en lib/config.ts): el
// usuario/clave propios del tipo si están completos, si no el global — la
// resolución del fallback ya ocurrió ahí, acá solo se lee el resultado.
function buildParamsForKind(kind: EmailKind): SelectEmailProviderParams {
  const account = MAIL_ACCOUNTS[kind];
  return {
    emailProvider: process.env.EMAIL_PROVIDER,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT,
    smtpUser: account.user || undefined,
    smtpPass: account.pass || undefined,
    nodeEnv: process.env.NODE_ENV,
  };
}

// Nombre resuelto para UN tipo de correo, sin crear ni cachear ninguna
// instancia. Usado por el script de verificación manual (test:email) para
// negarse a correr si algún tipo caería en "console" en vez de "smtp".
export function resolveEmailProviderName(kind: EmailKind): EmailProviderName {
  return selectEmailProvider(buildParamsForKind(kind));
}

const connectionCache = createProviderConnectionCache();
const providersByKind = new Map<EmailKind, EmailProvider>();

// Memoizado POR TIPO de correo a propósito: cada tipo puede autenticar con
// una cuenta SMTP distinta (ver MAIL_ACCOUNTS), pero cuando dos tipos
// resuelven a la misma cuenta comparten la misma conexión (ver
// resolveEmailProvider) en vez de abrir un pool por tipo.
export function getEmailProvider(kind: EmailKind): EmailProvider {
  const cached = providersByKind.get(kind);
  if (cached) return cached;

  const provider = resolveEmailProvider(buildParamsForKind(kind), connectionCache);
  providersByKind.set(kind, provider);
  return provider;
}
