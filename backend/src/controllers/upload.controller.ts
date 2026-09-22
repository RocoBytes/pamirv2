import { Request, Response } from 'express';
import Busboy from 'busboy';
import { getFileStorage } from '../lib/storage/get-file-storage.js';
import { buildObjectKey } from '../lib/storage/object-key.js';
import { deleteStoredFileBestEffort } from '../lib/storage/delete-best-effort.js';
import {
  MagicBytesGuard,
  INVALID_FILE_TYPE,
  PDF_SIGNATURE,
  JPEG_SIGNATURE,
  PNG_SIGNATURE,
  XML_SIGNATURES,
} from '../lib/storage/magic-bytes-guard.js';
import { prisma } from '../lib/prisma.js';
import { puedeGestionarSalida } from '../lib/authz.js';
import { bindTenantContext } from '../lib/tenant-context.js';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const ALLOWED_EXT = /\.gpx$/i;
export const ALLOWED_PRONOSTICO_EXT_STRICT = /\.(pdf|jpg|jpeg|png)$/i;

function sanitizeGpxFilename(raw: string): string {
  const base = raw
    .replace(/[/\\]/g, '')
    .replace(/[^\w\s.-]/g, '_')
    .trim()
    .slice(0, 200);
  return base.toLowerCase().endsWith('.gpx') ? base : `${base}.gpx`;
}

export function sanitizePronosticoFilename(raw: string): string {
  return raw
    .replace(/[/\\]/g, '')
    .replace(/[^\w\s.-]/g, '_')
    .trim()
    .slice(0, 200);
}

// Extensión real del archivo aceptado, tomada del grupo de captura de la
// extensión permitida (nunca se confía en el nombre subido para construir la
// clave del objeto — ver buildObjectKey).
function extractExtension(filename: string, allowed: RegExp): string {
  return (allowed.exec(filename)?.[1] ?? '').toLowerCase();
}

/**
 * POST /api/salidas/:id/gpx
 *
 * Recibe multipart/form-data con un único campo "file" conteniendo el .gpx.
 * Usa busboy para interceptar el stream y lo canaliza directamente al storage
 * configurado (ver lib/storage) — sin cargar el buffer completo en RAM.
 */
export async function uploadGpx(req: Request, res: Response): Promise<void> {
  const salidaId = req.params.id as string;
  const organizationId = req.user!.organizationId;

  // ── 1. Verificar que la salida existe ────────────────────────────────────────
  let salida;
  try {
    salida = await prisma.salida.findUnique({ where: { id: salidaId } });
  } catch (err) {
    console.error('[uploadGpx] DB error:', err);
    res.status(500).json({ error: 'Error interno al buscar la salida' });
    return;
  }

  if (!salida) {
    res.status(404).json({ error: 'Salida no encontrada' });
    return;
  }

  // ── 2. Verificar ownership — política deny-by-default ───────────────────────
  // Solo el dueño de la salida o un administrador pueden subir el GPX. Las
  // salidas legadas sin dueño (userId null) quedan reservadas al admin: un
  // usuario no-admin nunca puede subirles archivos.
  if (!puedeGestionarSalida(req.user, salida)) {
    res.status(403).json({ error: 'No tienes permiso para modificar esta salida' });
    return;
  }

  // ── 3. Parsear multipart con busboy ─────────────────────────────────────────
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
      files: 1,             // solo un archivo por request
      fileSize: MAX_FILE_SIZE,
    },
  });

  // AsyncLocalStorage no propaga de forma confiable hacia los callbacks de
  // eventos de busboy (problema conocido de Node/Express): sin este bind, el
  // update de más abajo se ejecutaría sin contexto de club y lanzaría. Esto es
  // obligatorio, no defensivo — bindTenantContext se crea ANTES de
  // req.pipe(busboy), mientras todavía estamos dentro del contexto del
  // request.
  busboy.on(
    'file',
    bindTenantContext(async (_fieldname, fileStream, info) => {
      const { filename: rawFilename, mimeType } = info;
      const filename = sanitizeGpxFilename(rawFilename);

      // Validar extensión
      if (!ALLOWED_EXT.test(rawFilename)) {
        fileStream.resume(); // drenar para evitar backpressure
        safeRespond(400, { error: 'Solo se permiten archivos .gpx' });
        return;
      }

      // Busboy emite 'limit' en el fileStream si el archivo supera fileSize
      fileStream.on('limit', () => {
        fileStream.resume();
        safeRespond(413, {
          error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
        });
      });

      const anteriorFileId = salida.gpxFileId;
      // Solo se acepta .gpx (ver ALLOWED_EXT, sin grupo de captura) — la
      // extensión del objeto siempre es literal, nunca depende del filename.
      const key = buildObjectKey({ organizationId, kind: 'gpx', extension: 'gpx' });

      // La extensión la elige quien sube; el guard mira los bytes reales y
      // corta antes de que nada llegue al bucket. Tolerante a propósito: un GPX
      // es XML y los exportadores de relojes y apps de montaña anteponen BOM o
      // saltos de línea sin dejar de ser válidos. Rechazar una traza buena le
      // cuesta a alguien que está registrando su salida antes de perder señal.
      const guardedGpx = fileStream.pipe(
        new MagicBytesGuard({ signatures: XML_SIGNATURES, allowLeadingWhitespace: true }),
      );

      try {
        await getFileStorage().upload(guardedGpx, {
          key,
          contentType: mimeType || 'application/gpx+xml',
          maxBytes: MAX_FILE_SIZE,
        });

        try {
          // gpxFileUrl nunca se llena para un objeto nuevo: la URL de descarga
          // se firma bajo demanda (ver GET /:id/archivos/:tipo/url) en vez de
          // guardarse — el bucket es privado.
          await prisma.salida.update({
            where: { id: salidaId },
            data: { gpxFileId: key, gpxFileName: filename, gpxFileUrl: null },
          });
        } catch (err) {
          // No dejar huérfano el objeto recién subido si la escritura falla.
          await deleteStoredFileBestEffort(key, 'uploadGpx');
          throw err;
        }

        safeRespond(200, {
          message: 'Archivo GPX subido exitosamente',
          gpxFileId: key,
          gpxFileName: filename,
        });

        // Reemplazo: el objeto anterior se borra recién después de responder,
        // best-effort (un id legado de Drive se ignora — ver el helper).
        deleteStoredFileBestEffort(anteriorFileId, 'uploadGpx');
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;

        if (code === INVALID_FILE_TYPE) {
          // Nada se escribió: el guard cortó con la cabecera.
          fileStream.resume();
          safeRespond(415, { error: 'El archivo no es un GPX válido' });
          return;
        }
        if (code === 'FILE_TOO_LARGE') {
          safeRespond(413, {
            error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
          });
          return;
        }

        console.error('[uploadGpx] Error subiendo el archivo:', err);
        safeRespond(500, { error: 'Error al subir el archivo' });
      }
    }),
  );

  busboy.on('error', (err) => {
    console.error('[uploadGpx] Busboy error:', err);
    safeRespond(500, { error: 'Error procesando el archivo' });
  });

  // Canalizar el request stream → busboy
  req.pipe(busboy);
}

/**
 * POST /api/salidas/:id/pronostico
 */
export async function uploadPronostico(req: Request, res: Response): Promise<void> {
  const salidaId = req.params.id as string;
  const organizationId = req.user!.organizationId;

  let salida;
  try {
    salida = await prisma.salida.findUnique({ where: { id: salidaId } });
  } catch (err) {
    console.error('[uploadPronostico] DB error:', err);
    res.status(500).json({ error: 'Error interno al buscar la salida' });
    return;
  }

  if (!salida) {
    res.status(404).json({ error: 'Salida no encontrada' });
    return;
  }

  // Misma política que uploadGpx: dueño o admin; las salidas legadas sin
  // dueño (userId null) quedan reservadas al admin.
  if (!puedeGestionarSalida(req.user, salida)) {
    res.status(403).json({ error: 'No tienes permiso para modificar esta salida' });
    return;
  }

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
      fileSize: MAX_FILE_SIZE,
    },
  });

  // Obligatorio, no defensivo — ver el comentario equivalente en uploadGpx:
  // el update de más abajo necesita el contexto de club capturado ANTES de
  // req.pipe(busboy).
  busboy.on(
    'file',
    bindTenantContext(async (_fieldname, fileStream, info) => {
      const { filename: rawFilename, mimeType } = info;
      const filename = sanitizePronosticoFilename(rawFilename);

      if (!ALLOWED_PRONOSTICO_EXT_STRICT.test(rawFilename)) {
        fileStream.resume();
        safeRespond(400, { error: 'Solo se permiten archivos PDF, JPG o PNG' });
        return;
      }

      fileStream.on('limit', () => {
        fileStream.resume();
        safeRespond(413, {
          error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
        });
      });

      const anteriorFileId = salida.pronosticoFileId;
      const key = buildObjectKey({
        organizationId,
        kind: 'pronostico',
        extension: extractExtension(rawFilename, ALLOWED_PRONOSTICO_EXT_STRICT),
      });

      // Formatos binarios: la cabecera está en el byte 0, sin ambigüedad.
      const guardedPronostico = fileStream.pipe(
        new MagicBytesGuard({ signatures: [PDF_SIGNATURE, JPEG_SIGNATURE, PNG_SIGNATURE] }),
      );

      try {
        await getFileStorage().upload(guardedPronostico, {
          key,
          contentType: mimeType || 'application/octet-stream',
          maxBytes: MAX_FILE_SIZE,
        });

        try {
          await prisma.salida.update({
            where: { id: salidaId },
            data: { pronosticoFileId: key, pronosticoFileName: filename, pronosticoFileUrl: null },
          });
        } catch (err) {
          await deleteStoredFileBestEffort(key, 'uploadPronostico');
          throw err;
        }

        safeRespond(200, {
          message: 'Archivo de pronóstico subido exitosamente',
          pronosticoFileId: key,
          pronosticoFileName: filename,
        });

        deleteStoredFileBestEffort(anteriorFileId, 'uploadPronostico');
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === INVALID_FILE_TYPE) {
          fileStream.resume();
          safeRespond(415, { error: 'El archivo no es un PDF ni una imagen válida' });
          return;
        }
        if (code === 'FILE_TOO_LARGE') {
          safeRespond(413, {
            error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
          });
          return;
        }
        console.error('[uploadPronostico] Error subiendo el archivo:', err);
        safeRespond(500, { error: 'Error al subir el archivo' });
      }
    }),
  );

  busboy.on('error', (err) => {
    console.error('[uploadPronostico] Busboy error:', err);
    safeRespond(500, { error: 'Error procesando el archivo' });
  });

  req.pipe(busboy);
}
