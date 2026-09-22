import Busboy from 'busboy';
import { prisma } from '../lib/prisma.js';
import { isAdmin } from '../lib/authz.js';
import { puedeVerDocumentos } from '../lib/documentos-access.js';
import { uploadToGoogleDrive, deleteFromGoogleDrive } from '../lib/google-drive.js';
import { bindTenantContext } from '../lib/tenant-context.js';
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const ALLOWED_DOC_EXT = /\.pdf$/i;
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
function sanitizeDocFilename(raw) {
    return raw
        .replace(/[/\\]/g, '')
        .replace(/[^\w\s.-]/g, '_')
        .trim()
        .slice(0, 200);
}
// GET /api/documentos — biblioteca del club, solo socios ACP y admin.
// El gate de membresía vive acá: ocultar el recuadro en el frontend es
// cosmético, la autorización real es esta.
export async function getDocumentos(req, res) {
    try {
        const email = req.user.email;
        const organization = req.user.organization;
        const admin = isAdmin(req.user);
        const integrante = admin
            ? null
            : await prisma.integrante.findFirst({
                where: { email },
                select: { membresiaClub: true },
            });
        if (!puedeVerDocumentos({
            isAdmin: admin,
            integranteMembresiaClub: integrante?.membresiaClub,
            membresiaPropia: organization.membresiaPropia,
        })) {
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
                driveFileUrl: true,
            },
        });
        res.json(documentos);
    }
    catch (error) {
        console.error('[getDocumentos]', error);
        res.status(500).json({ error: 'No se pudieron obtener los documentos' });
    }
}
// GET /api/documentos/admin — todos los documentos (incluye invisibles) para
// la gestión del admin. Detrás de requireAdmin.
export async function getDocumentosAdmin(_req, res) {
    try {
        const documentos = await prisma.documento.findMany({
            orderBy: [{ categoria: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
            select: {
                id: true,
                categoria: true,
                nombre: true,
                descripcion: true,
                driveFileUrl: true,
                visible: true,
                orden: true,
            },
        });
        res.json(documentos);
    }
    catch (error) {
        console.error('[getDocumentosAdmin]', error);
        res.status(500).json({ error: 'No se pudieron obtener los documentos' });
    }
}
/**
 * POST /api/documentos — admin sube un PDF.
 *
 * multipart/form-data con campos de texto (categoria, nombre, descripcion?,
 * orden?) y un campo "file" con el PDF. Se canaliza el stream directo a Google
 * Drive (Resumable Upload), sin cargar el buffer completo en RAM, y se crea el
 * registro Documento con el link público resultante. Detrás de requireAdmin.
 */
export async function createDocumento(req, res) {
    let responded = false;
    let fileSeen = false;
    const safeRespond = (status, body) => {
        if (!responded) {
            responded = true;
            res.status(status).json(body);
        }
    };
    const fields = {};
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
    busboy.on('file', bindTenantContext(async (_fieldname, fileStream, info) => {
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
        try {
            const result = await uploadToGoogleDrive(fileStream, sanitizeDocFilename(rawFilename), mimeType || 'application/pdf', MAX_FILE_SIZE);
            const documento = await prisma.documento.create({
                data: {
                    organizationId: req.user.organizationId,
                    categoria,
                    nombre,
                    descripcion: descripcion || null,
                    driveFileId: result.fileId,
                    driveFileUrl: result.webViewLink,
                    orden,
                    visible: true,
                },
                select: {
                    id: true,
                    categoria: true,
                    nombre: true,
                    descripcion: true,
                    driveFileUrl: true,
                    visible: true,
                    orden: true,
                },
            });
            safeRespond(201, documento);
        }
        catch (err) {
            const code = err.code;
            if (code === 'FILE_TOO_LARGE') {
                safeRespond(413, {
                    error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`,
                });
                return;
            }
            console.error('[createDocumento] Error subiendo a Google Drive:', err);
            safeRespond(500, { error: 'Error al subir el documento a Google Drive' });
        }
    }));
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
 * DELETE /api/documentos/:id — admin borra un documento (registro + archivo en
 * Drive). Detrás de requireAdmin.
 */
export async function deleteDocumento(req, res) {
    const id = req.params.id;
    try {
        const documento = await prisma.documento.findUnique({ where: { id } });
        if (!documento) {
            res.status(404).json({ error: 'Documento no encontrado' });
            return;
        }
        if (documento.driveFileId) {
            try {
                await deleteFromGoogleDrive(documento.driveFileId);
            }
            catch (err) {
                // No bloquear el borrado del registro si Drive falla (p.ej. el archivo
                // ya no existe): la fuente de verdad para la app es la DB.
                console.error('[deleteDocumento] No se pudo borrar de Drive:', err);
            }
        }
        await prisma.documento.delete({ where: { id } });
        res.json({ ok: true });
    }
    catch (error) {
        console.error('[deleteDocumento]', error);
        res.status(500).json({ error: 'No se pudo eliminar el documento' });
    }
}
