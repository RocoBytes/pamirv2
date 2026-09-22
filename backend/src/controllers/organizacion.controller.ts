import { Request, Response } from 'express';
import Busboy from 'busboy';
import { prisma } from '../lib/prisma.js';
import { getFileStorage } from '../lib/storage/get-file-storage.js';
import { buildObjectKey } from '../lib/storage/object-key.js';
import { deleteStoredFileBestEffort } from '../lib/storage/delete-best-effort.js';
import { MagicBytesGuard, INVALID_FILE_TYPE, PNG_SIGNATURE, JPEG_SIGNATURE } from '../lib/storage/magic-bytes-guard.js';
import { bindTenantContext } from '../lib/tenant-context.js';
import { logoVersionOf } from '../lib/serializers/organization.js';

// Muy por debajo del client_max_body_size 16m del nginx del frontend — no hay
// cambio de infraestructura por este límite.
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

// SVG queda excluido a propósito: es el único formato de imagen que puede
// llevar <script> adentro, y este archivo se renderiza inline en un <img> —a
// diferencia de PDF/GPX, que siempre se descargan como adjunto.
export const ALLOWED_LOGO_EXT = /\.(png|jpe?g)$/i;

// Exportada para poder probarla sin arnés HTTP — mismo criterio que
// sanitizeNavPreferences en nav-prefs.controller.ts.
export function contentTypeForLogo(extension: string): string {
  return extension === 'png' ? 'image/png' : 'image/jpeg';
}

/**
 * POST /api/organizacion/logo
 *
 * multipart/form-data con un único campo "file" (PNG/JPG, hasta 2 MB). El
 * stream se canaliza directo al storage configurado; reemplazar un logo
 * existente borra el objeto anterior recién después de responder.
 */
export async function uploadOrganizacionLogo(req: Request, res: Response): Promise<void> {
  const organizationId = req.user!.organizationId;
  // Ya la cargó authMiddleware en este mismo request — no hace falta una
  // consulta extra solo para saber qué objeto reemplazar.
  const previousKey = req.user!.organization.logoObjectKey;

  let responded = false;
  const safeRespond = (status: number, body: object) => {
    if (!responded) {
      responded = true;
      res.status(status).json(body);
    }
  };

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: 1,
      fileSize: MAX_LOGO_BYTES,
    },
  });

  let fileSeen = false;

  // Obligatorio, no defensivo — ver el comentario equivalente en
  // uploadItinerarioAdjunto (eventos-admin.controller.ts): AsyncLocalStorage
  // no propaga de forma confiable hacia los callbacks de eventos de busboy, y
  // el update de más abajo necesita el contexto de club capturado ANTES de
  // req.pipe(busboy).
  busboy.on(
    'file',
    bindTenantContext(async (_fieldname, fileStream, info) => {
      fileSeen = true;
      const { filename: rawFilename } = info;

      const extensionMatch = ALLOWED_LOGO_EXT.exec(rawFilename);
      if (!extensionMatch) {
        fileStream.resume();
        safeRespond(415, { error: 'Solo se permiten archivos PNG o JPG' });
        return;
      }

      fileStream.on('limit', () => {
        fileStream.resume();
        safeRespond(413, { error: `El logo supera el límite de ${MAX_LOGO_BYTES / 1024 / 1024} MB` });
      });

      // Extensión real tomada del grupo de captura, nunca del nombre completo
      // subido — igual que el resto de los uploads (ver object-key.ts).
      const extension = (extensionMatch[1] as string).toLowerCase();
      const key = buildObjectKey({ organizationId, kind: 'logo', extension });

      // Formato binario: la cabecera está en el byte 0, sin ambigüedad.
      const guardedLogo = fileStream.pipe(new MagicBytesGuard({ signatures: [PNG_SIGNATURE, JPEG_SIGNATURE] }));

      try {
        // El Content-Type se deriva de la extensión ya validada, nunca del
        // mimeType que declara el cliente (endurecimiento deliberado frente a
        // uploadPronostico: ahí es inocuo porque el archivo se descarga, acá
        // se renderiza inline en un <img>).
        await getFileStorage().upload(guardedLogo, {
          key,
          contentType: contentTypeForLogo(extension),
          maxBytes: MAX_LOGO_BYTES,
        });

        try {
          await prisma.organization.update({
            where: { id: organizationId },
            data: { logoObjectKey: key },
          });
        } catch (err) {
          // No dejar huérfano el objeto recién subido si la escritura falla.
          await deleteStoredFileBestEffort(key, 'uploadOrganizacionLogo');
          throw err;
        }

        safeRespond(200, { hasLogo: true, logoVersion: logoVersionOf(key) });

        // Reemplazo: el objeto anterior se borra recién después de responder,
        // best-effort.
        deleteStoredFileBestEffort(previousKey, 'uploadOrganizacionLogo');
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === INVALID_FILE_TYPE) {
          fileStream.resume();
          safeRespond(415, { error: 'El archivo no es una imagen PNG ni JPG válida' });
          return;
        }
        if (code === 'FILE_TOO_LARGE') {
          safeRespond(413, { error: `El logo supera el límite de ${MAX_LOGO_BYTES / 1024 / 1024} MB` });
          return;
        }
        console.error('[uploadOrganizacionLogo] Error subiendo el logo:', err);
        safeRespond(500, { error: 'Error al subir el logo' });
      }
    }),
  );

  busboy.on('error', (err) => {
    console.error('[uploadOrganizacionLogo] Busboy error:', err);
    safeRespond(500, { error: 'Error procesando el archivo' });
  });

  // Si el request terminó sin ningún archivo, responder en vez de colgar.
  busboy.on('close', () => {
    if (!fileSeen) {
      safeRespond(400, { error: 'No se recibió ningún archivo' });
    }
  });

  req.pipe(busboy);
}

/**
 * DELETE /api/organizacion/logo
 *
 * Quita la referencia al logo y borra el objeto guardado, best-effort.
 * Idempotente: responde igual aunque el club no tuviera logo propio.
 */
export async function deleteOrganizacionLogo(req: Request, res: Response): Promise<void> {
  const organizationId = req.user!.organizationId;
  const previousKey = req.user!.organization.logoObjectKey;

  try {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { logoObjectKey: null },
    });

    res.json({ hasLogo: false });

    deleteStoredFileBestEffort(previousKey, 'deleteOrganizacionLogo');
  } catch (error) {
    console.error('[deleteOrganizacionLogo]', error);
    res.status(500).json({ error: 'Error al quitar el logo' });
  }
}
