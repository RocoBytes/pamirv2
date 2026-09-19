import { google } from 'googleapis';
import { GoogleApiError, toGoogleApiError } from './google-errors.js';
import { recordGoogleAuthFailure, recordGoogleAuthSuccess } from './google-health.js';
let oauth2Client = null;
/**
 * Cliente OAuth2 único para Gmail y Drive: ambos usan el mismo
 * `GOOGLE_REFRESH_TOKEN`, así que compartirlo también comparte la caché del
 * access token (~1 h) y evita refrescos duplicados.
 *
 * Se memoriza a nivel de módulo: un token nuevo en el `.env` exige recrear el
 * proceso (`docker compose up -d --force-recreate backend`).
 */
export function getOAuth2Client() {
    if (oauth2Client)
        return oauth2Client;
    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    oauth2Client = client;
    return client;
}
/**
 * Comprueba que el refresh token siga vivo, sin enviar nada.
 * Barato: googleapis cachea el access token y sólo llama a Google cuando ya
 * caducó, así que la sonda de cada 10 minutos toca la red ~una vez por hora.
 */
export async function probeGoogleAuth() {
    try {
        const { token } = await getOAuth2Client().getAccessToken();
        if (!token) {
            // Sin access token las credenciales no sirven: cuenta como fallo de auth.
            throw new GoogleApiError('Google API 401: Google no devolvió un access token', 401);
        }
        recordGoogleAuthSuccess();
        return true;
    }
    catch (err) {
        const wrapped = toGoogleApiError(err);
        if (recordGoogleAuthFailure(wrapped)) {
            console.error('[google-auth] Credenciales de Google caídas:', wrapped.message);
        }
        return false;
    }
}
