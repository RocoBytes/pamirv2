import { google } from 'googleapis';
import { prisma } from './prisma.js';
import { decryptSecret, encryptSecret } from './secret-crypto.js';

/**
 * Origen del refresh token de Google que usan Gmail y Drive.
 *
 * La pantalla de consentimiento OAuth está en estado "Testing", así que Google
 * caduca el refresh token cada 7 días. Antes renovarlo exigía entrar por SSH al
 * VPS, editar /opt/pamir/.env y recrear el contenedor; ahora se pega desde el
 * panel de administración y queda activo al instante.
 *
 * Precedencia: base de datos → variable de entorno. El entorno sigue siendo el
 * respaldo para desarrollo local y para el arranque previo al primer guardado.
 */

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GOOGLE_REFRESH_TOKEN_KEY = 'google_refresh_token';

export type OrigenCredencial = 'db' | 'env';

export interface PruebaCredencial {
  ok: boolean;
  motivo: string | null;
}

export interface EstadoCredencial {
  configurado: boolean;
  origen: OrigenCredencial;
  actualizadoAt: string | null;
  actualizadoPor: string | null;
  diasDesdeActualizacion: number | null;
  estado: PruebaCredencial;
}

// Única caché del módulo. Es correcta porque el backend corre en UNA sola
// réplica por diseño (deploy/docker-compose.yml), la misma premisa que ya
// asumen dispatchLocks en notificaciones.ts y el rate limiter en memoria.
// Se cachea la promesa, no el resultado, para que dos peticiones simultáneas no
// disparen dos lecturas y dos refrescos de token.
let clientePendiente: Promise<{ client: OAuth2Client; origen: OrigenCredencial }> | null = null;

/**
 * El error de gaxios lleva el refresh_token EN CLARO dentro de `config.data` y
 * `config.body` — gaxios redacta `client_secret` y `grant_type`, pero no el
 * refresh token. Aquí el token puede venir recién pegado en un formulario, así
 * que se extraen sólo campos seguros y el objeto original nunca se propaga.
 */
function describirErrorGoogle(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;

  if (data && typeof data === 'object') {
    const { error, error_description: descripcion } = data as Record<string, unknown>;

    if (error === 'invalid_grant') {
      return 'El token es inválido, está caducado o fue revocado.';
    }
    if (error === 'invalid_client') {
      return 'El GOOGLE_CLIENT_ID o el GOOGLE_CLIENT_SECRET del servidor no coinciden con este token.';
    }
    if (typeof descripcion === 'string') return descripcion;
    if (typeof error === 'string') return error;
  }

  return 'Google rechazó las credenciales.';
}

function construirCliente(refreshToken: string | undefined): OAuth2Client {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function resolverToken(): Promise<{ token: string | undefined; origen: OrigenCredencial }> {
  try {
    const fila = await prisma.appSecret.findUnique({
      where: { key: GOOGLE_REFRESH_TOKEN_KEY },
    });
    if (fila) return { token: decryptSecret(fila.value), origen: 'db' };
  } catch (err) {
    // Cifrado ilegible (rotó JWT_SECRET) o base inaccesible. Se cae al entorno
    // en vez de dejar la app sin correo; el panel muestra el problema y permite
    // volver a pegar el token.
    console.error(
      '[google-credentials] No se pudo leer el token guardado:',
      err instanceof Error ? err.message : err,
    );
  }

  return { token: process.env.GOOGLE_REFRESH_TOKEN, origen: 'env' };
}

/** Cliente OAuth2 compartido por Gmail y Drive (comparte la caché del access token). */
export async function getOAuth2Client(): Promise<OAuth2Client> {
  clientePendiente ??= resolverToken().then(({ token, origen }) => ({
    client: construirCliente(token),
    origen,
  }));

  try {
    return (await clientePendiente).client;
  } catch (err) {
    clientePendiente = null; // no dejar cacheado un fallo transitorio
    throw err;
  }
}

/**
 * Obliga a releer el token en la próxima llamada. La llama el guardado, y es lo
 * que hace que un token pegado en el panel surta efecto sin recrear el proceso.
 */
export function invalidateGoogleCredentials(): void {
  clientePendiente = null;
}

/**
 * Comprueba contra Google que un refresh token sirve. Sin argumento prueba el
 * que está en uso; con argumento, uno candidato (antes de guardarlo).
 */
export async function probarRefreshToken(refreshToken?: string): Promise<PruebaCredencial> {
  const client = refreshToken === undefined ? await getOAuth2Client() : construirCliente(refreshToken);

  try {
    const { token } = await client.getAccessToken();
    if (!token) return { ok: false, motivo: 'Google no devolvió un access token.' };
    return { ok: true, motivo: null };
  } catch (err) {
    return { ok: false, motivo: describirErrorGoogle(err) };
  }
}

/** Metadatos para el panel. NUNCA incluye el token ni un fragmento. */
export async function getEstadoCredencial(): Promise<EstadoCredencial> {
  const fila = await prisma.appSecret.findUnique({
    where: { key: GOOGLE_REFRESH_TOKEN_KEY },
  });

  const origen: OrigenCredencial = fila ? 'db' : 'env';
  const configurado = fila !== null || Boolean(process.env.GOOGLE_REFRESH_TOKEN);

  const diasDesdeActualizacion = fila
    ? Math.floor((Date.now() - fila.updatedAt.getTime()) / 86_400_000)
    : null;

  return {
    configurado,
    origen,
    actualizadoAt: fila?.updatedAt.toISOString() ?? null,
    actualizadoPor: fila?.updatedBy ?? null,
    diasDesdeActualizacion,
    estado: configurado
      ? await probarRefreshToken()
      : { ok: false, motivo: 'No hay ningún token configurado.' },
  };
}

/** Cifra y persiste el token. El llamador ya lo validó contra Google. */
export async function guardarRefreshToken(refreshToken: string, actualizadoPor: string): Promise<void> {
  const value = encryptSecret(refreshToken);

  await prisma.appSecret.upsert({
    where: { key: GOOGLE_REFRESH_TOKEN_KEY },
    create: { key: GOOGLE_REFRESH_TOKEN_KEY, value, updatedBy: actualizadoPor },
    update: { value, updatedBy: actualizadoPor },
  });

  invalidateGoogleCredentials();
}
