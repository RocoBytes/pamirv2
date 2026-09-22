import { Request, Response } from 'express';
import Busboy from 'busboy';
import { prisma } from '../lib/prisma.js';
import { isAdmin } from '../lib/authz.js';
import { puedeVerDocumentos } from '../lib/documentos-access.js';
import { getFileStorage } from '../lib/storage/get-file-storage.js';
import { buildObjectKey } from '../lib/storage/object-key.js';
import { deleteStoredFileBestEffort } from '../lib/storage/delete-best-effort.js';
import { resolveFileDownload } from '../lib/storage/resolve-file-download.js';
import { bindTenantContext } from '../lib/tenant-context.js';
import { MagicBytesGuard, INVALID_FILE_TYPE } from '../lib/storage/magic-bytes-guard.js';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const ALLOWED_DOC_EXT = /\.pdf$/i;
const DOCUMENTO_DOWNLOAD_SECONDS = 600;

// Set conocido de categorías de la biblioteca. Debe mantenerse en sync con
// CATEGORIA_LABELS del frontend (frontend/src/lib/documentos.ts).
const DOCUMENTO_CATEGORIAS = [
  'AVISO_EXPEDICION',
  'MATRIZ_RIESGO',
  'CHECKLIST',
  'GLOSARIO',
  'LIBROS',
  'OTRO',
];

// GET /api/documentos — biblioteca del club, solo socios ACP y admin.
// El gate de membresía vive acá: ocultar el recuadro en el frontend es
// cosmético, la autorización real es esta.
export async function getDocumentos(req: Request, res: Response): Promise<void> {
  try {
    const email = req.user!.email;
    const organization = req.user!.organization;
    const admin = isAdmin(req.user);

    const integrante = admin
      ? null
      : await prisma.integrante.findFirst({
          where: { email },
          select: { membresiaClub: true },
        });

    if (
      !puedeVerDocumentos({
        isAdmin: admin,
        integranteMembresiaClub: integrante?.membresiaClub,
        membresiaPropia: organization.membresiaPropia,
      })
    ) {
      res.status(403).json({ error: `Sección exclusiva para socios de ${organization.name}` });
      return;
    }

    const documentos = await prisma.documento.findMany({
      where: { visible: true },
      orderBy: [{ categoria: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
      select: {
        id: true,
        categoria: true,
        nombre: true,
        descripcion: true,
        driveFileId: true,
      },
    });

    res.json(documentos);
  } catch (error) {
    console.error('[getDocumentos]', error);
    res.status(500).json({ error: 'No se pudieron obtener los documentos' });
  }
}

// GET /api/documentos/admin — todos los documentos (incluye invisibles) para
// la gestión del admin. Detrás de requireAdmin.
export async function getDocumentosAdmin(_req: Request, res: Response): Promise<void> {
  try {
    const documentos = await prisma.documento.findMany({
      orderBy: [{ categoria: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
      select: {
        id: true,
        categoria: true,
        nombre: true,
        descripcion: true,
        driveFileId: true,
        visible: true,
        orden: true,
      },
    });
    res.json(documentos);
  } catch (error) {
    console.error('[getDocumentosAdmin]', error);
    res.status(500).json({ error: 'No se pudieron obtener los documentos' });
  }
}

/**
 * POST /api/documentos — admin sube un PDF.
 *
 * multipart/form-data con campos de texto (categoria, nombre, descripcion?,
 * orden?) y un campo "file" con el PDF. Se canaliza el stream directo al
 * storage configurado (ver lib/storage), sin cargar el buffer completo en
 * RAM, y se crea el registro Documento con la clave del objeto resultante
 * (nunca una URL: el bucket es privado). Detrás de requireAdmin.
 */
export async function createDocumento(req: Request, res: Response): Promise<void> {
  const organizationId = req.user!.organizationId;
  let responded = false;
  let fileSeen = false;

  const safeRespond = (status: number, body: object) => {
    if (!responded) {
      responded = true;
      res.status(status).json(body);
    }
  };

  const fields: Record<string, string> = {};

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: 1,
      fileSize: MAX_FILE_SIZE,
    },
  });

  // Los campos de texto llegan antes que el archivo (el frontend agrega el
  // "file" al final del FormData), así están poblados cuando dispara 'file'.
  busboy.on('field', (name, value) => {
    fields[name] = value;
  });

  // Obligatorio, no defensivo: AsyncLocalStorage no propaga de forma
  // confiable hacia los callbacks de eventos de busboy. El create de más
  // abajo necesita el contexto de club capturado ANTES de req.pipe(busboy).
  busboy.on(
    'file',
    bindTenantContext(async (_fieldname, fileStream, info) => {
      fileSeen = true;
      const { filename: rawFilename, mimeType } = info;

      if (!ALLOWED_DOC_EXT.test(rawFilename)) {
        fileStream.resume();
        safeRespond(400, { error: 'Solo se permiten archivos PDF' });
        return;
      }

      const categoria = (fields.categoria ?? '').trim();
      const nombre = (fields.nombre ?? '').trim();
      const descripcion = (fields.descripcion ?? '').trim();
      const ordenRaw = (fields.orden ?? '').trim();

      if (!DOCUMENTO_CATEGORIAS.includes(categoria)) {
        fileStream.resume();
        safeRespond(400, { error: 'Categoría inválida' });
        return;
      }
      if (!nombre) {
        fileStream.resume();
        safeRespond(400, { error: 'El nombre es obligatorio' });
        return;
      }
      const orden = ordenRaw !== '' && Number.isFinite(Number(ordenRaw))
        ? parseInt(ordenRaw, 10)
        : 0;

      fileStream.on('limit', () => {
        fileStream.resume();
        safeRespond(413, {
          error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
        });
      });

      const key = buildObjectKey({ organizationId, kind: 'documento', extension: 'pdf' });

      // La extensión la elige quien sube, así que no prueba nada por sí sola:
      // el guard mira los primeros bytes reales y corta el stream antes de que
      // nada llegue al bucket si el contenido no es un PDF.
      const guarded = fileStream.pipe(new MagicBytesGuard());

      try {
        await getFileStorage().upload(guarded, {
          key,
          contentType: mimeType || 'application/pdf',
          maxBytes: MAX_FILE_SIZE,
        });

        let documento;
        try {
          documento = await prisma.documento.create({
            data: {
              organizationId,
              categoria,
              nombre,
              descripcion: descripcion || null,
              driveFileId: key,
              driveFileUrl: null,
              orden,
              visible: true,
            },
            select: {
              id: true,
              categoria: true,
              nombre: true,
              descripcion: true,
              driveFileId: true,
              visible: true,
              orden: true,
            },
          });
        } catch (err) {
          // No dejar huérfano el objeto recién subido si la escritura falla.
          await deleteStoredFileBestEffort(key, 'createDocumento');
          throw err;
        }

        safeRespond(201, documento);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === INVALID_FILE_TYPE) {
          // Sobró con la cabecera: nada se escribió, no hay objeto que limpiar.
          // 415 y no 400 porque el problema es el tipo de archivo, no un campo
          // del formulario mal completado.
          fileStream.resume();
          safeRespond(415, { error: 'El archivo no es un PDF válido' });
          return;
        }
        if (code === 'FILE_TOO_LARGE') {
          safeRespond(413, {
            error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
          });
          return;
        }
        console.error('[createDocumento] Error subiendo el documento:', err);
        safeRespond(500, { error: 'Error al subir el documento' });
      }
    }),
  );

  busboy.on('error', (err) => {
    console.error('[createDocumento] Busboy error:', err);
    safeRespond(500, { error: 'Error procesando el archivo' });
  });

  // Si la request terminó sin archivo, responder en vez de colgar.
  // fileSeen se setea sincrónicamente al inicio del handler 'file', y 'close'
  // llega después de 'file', así que no hay carrera con la subida async.
  busboy.on('close', () => {
    if (!fileSeen) {
      safeRespond(400, { error: 'No se recibió ningún archivo' });
    }
  });

  req.pipe(busboy);
}

/**
 * DELETE /api/documentos/:id — admin borra un documento (registro + archivo
 * del storage). Detrás de requireAdmin.
 */
export async function deleteDocumento(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  try {
    const documento = await prisma.documento.findUnique({ where: { id } });
    if (!documento) {
      res.status(404).json({ error: 'Documento no encontrado' });
      return;
    }

    // Best-effort: un id legado de Google Drive (Drive ya no existe) se
    // ignora en silencio — ver el helper.
    await deleteStoredFileBestEffort(documento.driveFileId, 'deleteDocumento');

    await prisma.documento.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('[deleteDocumento]', error);
    res.status(500).json({ error: 'No se pudo eliminar el documento' });
  }
}

/**
 * GET /api/documentos/:id/url — URL de descarga del PDF de un documento de la
 * biblioteca. Misma regla de acceso que GET /api/documentos (puedeVerDocumentos).
 */
export async function getDocumentoUrl(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');

  try {
    const id = req.params.id as string;
    const documento = await prisma.documento.findUnique({ where: { id } });
    if (!documento) {
      res.status(404).json({ error: 'Documento no encontrado' });
      return;
    }

    const email = req.user!.email;
    const organization = req.user!.organization;
    const admin = isAdmin(req.user);

    const integrante = admin
      ? null
      : await prisma.integrante.findFirst({
          where: { email },
          select: { membresiaClub: true },
        });

    if (
      !puedeVerDocumentos({
        isAdmin: admin,
        integranteMembresiaClub: integrante?.membresiaClub,
        membresiaPropia: organization.membresiaPropia,
      })
    ) {
      res.status(403).json({ error: `Sección exclusiva para socios de ${organization.name}` });
      return;
    }

    const resolution = resolveFileDownload(
      { fileId: documento.driveFileId, legacyUrl: documento.driveFileUrl, downloadName: `${documento.nombre}.pdf` },
      req.user!.organizationId,
    );

    switch (resolution.kind) {
      case 'absent':
        res.status(404).json({ error: 'El documento no tiene un archivo asociado' });
        return;
      case 'mismatch':
        console.error(`[getDocumentoUrl] clave ${resolution.key} no pertenece al club solicitante`);
        res.status(404).json({ error: 'El documento no tiene un archivo asociado' });
        return;
      case 'legacy':
        res.json({ url: resolution.url, expiresInSeconds: null });
        return;
      case 'signed': {
        const url = await getFileStorage().createSignedDownloadUrl(resolution.key, {
          expiresInSeconds: DOCUMENTO_DOWNLOAD_SECONDS,
          downloadName: resolution.downloadName,
        });
        res.json({ url, expiresInSeconds: DOCUMENTO_DOWNLOAD_SECONDS });
        return;
      }
    }
  } catch (error) {
    console.error('[getDocumentoUrl]', error);
    res.status(500).json({ error: 'No se pudo generar el enlace de descarga' });
  }
}
