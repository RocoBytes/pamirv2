import { Request, Response } from 'express';
import Busboy from 'busboy';
import { uploadToGoogleDrive } from '../lib/google-drive.js';
import { prisma } from '../lib/prisma.js';

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

/**
 * POST /api/salidas/:id/gpx
 *
 * Recibe multipart/form-data con un único campo "file" conteniendo el .gpx.
 * Usa busboy para interceptar el stream y lo canaliza directamente a Google
 * Drive via Resumable Upload — sin cargar el buffer completo en RAM.
 */
export async function uploadGpx(req: Request, res: Response): Promise<void> {
  const salidaId = req.params.id as string;

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
  // Si la salida tiene dueño registrado, sólo ese dueño puede subir el GPX.
  const salidaOwner = salida.userId;
  const requesterId = req.user?.id ?? null;
  if (salidaOwner !== null) {
    if (requesterId === null) {
      res.status(401).json({ error: 'Debes iniciar sesión para subir archivos a esta salida' });
      return;
    }
    if (requesterId !== salidaOwner) {
      res.status(403).json({ error: 'No tienes permiso para modificar esta salida' });
      return;
    }
  }
  // Salidas sin dueño (creadas como invitado) admiten upload sin autenticación

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

  busboy.on('file', async (_fieldname, fileStream, info) => {
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

    try {
      const result = await uploadToGoogleDrive(
        fileStream,
        filename,
        mimeType || 'application/gpx+xml',
        MAX_FILE_SIZE,
      );

      // Actualizar la salida con los datos del archivo en Drive
      await prisma.salida.update({
        where: { id: salidaId },
        data: {
          gpxFileId: result.fileId,
          gpxFileName: result.fileName,
          gpxFileUrl: result.webViewLink,
        },
      });

      safeRespond(200, {
        message: 'Archivo GPX subido exitosamente',
        gpxFileId: result.fileId,
        gpxFileName: result.fileName,
        gpxFileUrl: result.webViewLink,
      });
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;

      if (code === 'FILE_TOO_LARGE') {
        safeRespond(413, {
          error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
        });
        return;
      }

      console.error('[uploadGpx] Error subiendo a Google Drive:', err);
      safeRespond(500, { error: 'Error al subir el archivo a Google Drive' });
    }
  });

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

  const salidaOwner = salida.userId;
  const requesterId = req.user?.id ?? null;
  if (salidaOwner !== null) {
    if (requesterId === null) {
      res.status(401).json({ error: 'Debes iniciar sesión para subir archivos a esta salida' });
      return;
    }
    if (requesterId !== salidaOwner) {
      res.status(403).json({ error: 'No tienes permiso para modificar esta salida' });
      return;
    }
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

  busboy.on('file', async (_fieldname, fileStream, info) => {
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

    try {
      const result = await uploadToGoogleDrive(
        fileStream,
        filename,
        mimeType || 'application/octet-stream',
        MAX_FILE_SIZE,
      );

      await prisma.salida.update({
        where: { id: salidaId },
        data: {
          pronosticoFileId: result.fileId,
          pronosticoFileName: result.fileName,
          pronosticoFileUrl: result.webViewLink,
        },
      });

      safeRespond(200, {
        message: 'Archivo de pronóstico subido exitosamente',
        pronosticoFileId: result.fileId,
        pronosticoFileName: result.fileName,
        pronosticoFileUrl: result.webViewLink,
      });
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'FILE_TOO_LARGE') {
        safeRespond(413, {
          error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
        });
        return;
      }
      console.error('[uploadPronostico] Error subiendo a Google Drive:', err);
      safeRespond(500, { error: 'Error al subir el archivo a Google Drive' });
    }
  });

  busboy.on('error', (err) => {
    console.error('[uploadPronostico] Busboy error:', err);
    safeRespond(500, { error: 'Error procesando el archivo' });
  });

  req.pipe(busboy);
}
