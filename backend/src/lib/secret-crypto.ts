import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Cifrado simétrico para los secretos que viven en la tabla `app_secrets`.
 *
 * Por qué: mover una credencial viva (el refresh token de Google) desde una
 * variable de entorno a una fila de base de datos la expone a cualquier backup o
 * volcado de Neon. Cifrarla devuelve esa protección.
 *
 * AES-256-GCM con clave derivada de JWT_SECRET, que ya es obligatorio. Se usa
 * GCM y no CBC porque autentica: un valor manipulado falla al descifrar en vez
 * de devolver basura que acabaría enviándose a Google.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // tamaño recomendado para GCM
const TAG_BYTES = 16;

// Salt fijo a propósito: la clave tiene que ser reproducible entre reinicios y
// entre el contenedor y las migraciones. El secreto real es JWT_SECRET.
const KEY_SALT = 'pamir:app-secrets:v1';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET es obligatorio para cifrar secretos de la aplicación');
  }

  cachedKey = scryptSync(secret, KEY_SALT, 32);
  return cachedKey;
}

/** Devuelve `iv.tag.ciphertext`, todo en base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

/**
 * Lanza si el valor está manipulado o si JWT_SECRET cambió desde que se cifró.
 * Los llamadores tratan ese fallo como "no hay secreto guardado" y caen al
 * entorno, de modo que el panel pueda pedir que se vuelva a pegar.
 */
export function decryptSecret(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 3) {
    throw new Error('Secreto con formato inválido');
  }

  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'));
  if (iv!.length !== IV_BYTES || tag!.length !== TAG_BYTES) {
    throw new Error('Secreto con formato inválido');
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv!);
  decipher.setAuthTag(tag!);

  return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString('utf8');
}
