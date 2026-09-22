import { randomUUID } from 'node:crypto';

// Tipos de archivo que este backend guarda en el bucket de almacenamiento —
// ver buildObjectKey. Agregar uno nuevo es una decisión explícita acá.
export type FileKind = 'gpx' | 'pronostico' | 'documento' | 'itinerario' | 'logo';

const FILE_KINDS: readonly FileKind[] = ['gpx', 'pronostico', 'documento', 'itinerario', 'logo'];

// Mismo patrón conservador que el resto de la app asume para Organization.id
// (uuid() por defecto, pero nunca se depende del formato exacto): sin "/",
// "." ni espacios, para que jamás pueda alterar la forma del prefijo del
// objeto ni escapar de la carpeta del club.
const ORG_ID_FRAGMENT = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
const ORGANIZATION_ID_PATTERN = new RegExp(`^${ORG_ID_FRAGMENT}$`);
const EXTENSION_PATTERN = /^[a-z0-9]{1,5}$/;
const UUID_FRAGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const OBJECT_KEY_PATTERN = new RegExp(
  `^orgs/(${ORG_ID_FRAGMENT})/(${FILE_KINDS.join('|')})/${UUID_FRAGMENT}\\.[a-z0-9]{1,5}$`,
);
const ORGANIZATION_PREFIX_PATTERN = new RegExp(`^orgs/${ORG_ID_FRAGMENT}/$`);

export interface BuildObjectKeyParams {
  organizationId: string;
  kind: FileKind;
  extension: string;
}

/**
 * Construye la clave de un objeto en el bucket:
 * `orgs/{organizationId}/{kind}/{uuid}.{ext}`. Pura y determinista salvo por
 * el uuid aleatorio. Nunca incorpora el nombre original del archivo subido —
 * ese nombre (ya sanitizado por el controlador) se guarda aparte en la base,
 * nunca en la clave — así un intento de traversal o inyección en el nombre
 * jamás llega a tocar la ruta del objeto.
 */
export function buildObjectKey({ organizationId, kind, extension }: BuildObjectKeyParams): string {
  if (!ORGANIZATION_ID_PATTERN.test(organizationId)) {
    throw new Error(`organizationId inválido para una clave de objeto: "${organizationId}"`);
  }
  if (!FILE_KINDS.includes(kind)) {
    throw new Error(`Tipo de archivo desconocido para una clave de objeto: "${String(kind)}"`);
  }
  const ext = extension.toLowerCase();
  if (!EXTENSION_PATTERN.test(ext)) {
    throw new Error(`Extensión inválida para una clave de objeto: "${extension}"`);
  }
  return `orgs/${organizationId}/${kind}/${randomUUID()}.${ext}`;
}

/**
 * true solo para strings con exactamente esta forma. Las filas legadas
 * guardan un id de archivo de Google Drive en la misma columna — así es como
 * se distinguen las filas viejas de las nuevas sin una columna adicional.
 */
export function isObjectKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && OBJECT_KEY_PATTERN.test(value);
}

/** true solo cuando la clave es un objeto bajo `orgs/{organizationId}/`. */
export function objectKeyBelongsTo(key: string, organizationId: string): boolean {
  if (!isObjectKey(key)) return false;
  if (!ORGANIZATION_ID_PATTERN.test(organizationId)) return false;
  return key.startsWith(`orgs/${organizationId}/`);
}

/** Prefijo de todos los objetos de un club — usado también por deleteByPrefix. */
export function organizationPrefix(organizationId: string): string {
  if (!ORGANIZATION_ID_PATTERN.test(organizationId)) {
    throw new Error(`organizationId inválido para un prefijo de objeto: "${organizationId}"`);
  }
  return `orgs/${organizationId}/`;
}

/**
 * Guarda de seguridad para el deleteByPrefix de los adaptadores: rechaza
 * cualquier prefijo que no sea exactamente el de un club (`orgs/{id}/`). Un
 * prefijo vacío, corto o mal formado jamás debe poder alcanzar —y borrar— el
 * bucket completo.
 */
export function assertSafeObjectPrefix(prefix: string): void {
  if (!ORGANIZATION_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Prefijo de borrado inválido o inseguro: "${prefix}"`);
  }
}
