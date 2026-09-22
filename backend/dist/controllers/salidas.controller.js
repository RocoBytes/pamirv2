import { prisma } from '../lib/prisma.js';
import { sendClubEmail } from '../lib/email/club-email.js';
import { buildSalidaNotificationEmail, brandingFor } from '../lib/email-templates.js';
import { subjectRegistroSalida } from '../lib/email/subjects.js';
import { isAdmin, puedeGestionarSalida } from '../lib/authz.js';
import { instanteSantiago } from '../lib/santiago-time.js';
import { errorFechaCalendario } from '../lib/fecha-calendario.js';
import { serializeSalida } from '../lib/serializers/salida.js';
import { getFileStorage } from '../lib/storage/get-file-storage.js';
import { deleteStoredFileBestEffort } from '../lib/storage/delete-best-effort.js';
import { resolveFileDownload } from '../lib/storage/resolve-file-download.js';
const ARCHIVO_DOWNLOAD_SECONDS = 600;
const asJson = (v) => v;
async function sendSalidaParticipantEmails(participantObjs, salida, organization) {
    const participants = participantObjs;
    const recipients = [];
    // Registered integrantes: resolve their email by RUT (express entries excluded).
    const ruts = participants
        .filter((p) => p && !p.esExpress && p.rut)
        .map((p) => p.rut);
    if (ruts.length > 0) {
        const integrantes = await prisma.integrante.findMany({
            where: { rut: { in: ruts } },
            select: { email: true, nombreCompleto: true },
        });
        for (const i of integrantes) {
            recipients.push({ email: i.email, nombre: i.nombreCompleto });
        }
    }
    // Express participants: notify using the email captured in the express form.
    for (const p of participants) {
        if (p && p.esExpress && p.email && p.nombre) {
            recipients.push({ email: p.email, nombre: p.nombre });
        }
    }
    if (recipients.length === 0)
        return;
    const branding = brandingFor(organization);
    for (const r of recipients) {
        await sendClubEmail(organization, {
            to: r.email,
            subject: subjectRegistroSalida(branding, salida.nombreActividad),
            html: buildSalidaNotificationEmail(r.nombre, salida, branding),
            kind: 'notificacion',
        }).catch((err) => console.error(`[salida-email] Fallo al enviar a ${r.email}:`, err));
        await new Promise((resolve) => setTimeout(resolve, 350));
    }
}
// Express participants carry no ficha; stamp who added them and when so the
// salida keeps an auditable record. Trust server-side values, not the client.
// On re-save (edits) the original stamp is preserved — only new express entries
// get stamped.
function normalizeParticipantes(participantObjs, addedBy) {
    const nowIso = new Date().toISOString();
    return participantObjs.map((p) => {
        if (p && p.esExpress === true) {
            return {
                ...p,
                esExpress: true,
                agregadoPor: p.agregadoPor ?? addedBy,
                agregadoEn: p.agregadoEn ?? nowIso,
            };
        }
        return p;
    });
}
/**
 * Scheduled departure instant of a salida, in Santiago time. fechaInicio is
 * stored as midnight UTC of the chosen calendar date; horaInicio is "HH:MM".
 * Legacy salidas without horaInicio fall back to 23:59 (editable through the day).
 */
function departureMoment(salida) {
    const dateStr = salida.fechaInicio.toISOString().slice(0, 10);
    const hora = salida.horaInicio ?? '23:59';
    return instanteSantiago(dateStr, hora);
}
// Los integrantes son editables solo si la salida está EN_CURSO y la fecha+hora
// de salida todavía no se alcanzó.
function isIntegrantesEditable(salida, now) {
    return salida.status === 'EN_CURSO' && now < departureMoment(salida);
}
function participanteChanged(a, b) {
    return ((a.nombre ?? '') !== (b.nombre ?? '') ||
        Boolean(a.esExpress) !== Boolean(b.esExpress) ||
        (a.telefono ?? '') !== (b.telefono ?? '') ||
        (a.email ?? '') !== (b.email ?? '') ||
        (a.membresiaClub ?? '') !== (b.membresiaClub ?? ''));
}
// Diff participantes by RUT to build the audit trail (added / removed / modified).
function diffIntegrantesAudit(prev, next, por) {
    const nowIso = new Date().toISOString();
    const entries = [];
    const prevByRut = new Map(prev.filter((p) => p?.rut).map((p) => [p.rut, p]));
    const nextByRut = new Map(next.filter((p) => p?.rut).map((p) => [p.rut, p]));
    for (const [rut, p] of nextByRut) {
        const before = prevByRut.get(rut);
        if (!before) {
            entries.push({ accion: 'agrego', rut, nombre: p.nombre ?? '', por, en: nowIso });
        }
        else if (participanteChanged(before, p)) {
            entries.push({ accion: 'modifico', rut, nombre: p.nombre ?? before.nombre ?? '', por, en: nowIso });
        }
    }
    for (const [rut, p] of prevByRut) {
        if (!nextByRut.has(rut)) {
            entries.push({ accion: 'elimino', rut, nombre: p.nombre ?? '', por, en: nowIso });
        }
    }
    return entries;
}
export async function createSalida(req, res) {
    try {
        const data = req.body;
        const userId = req.user.id;
        // Solo el admin puede crear registros históricos (fecha pasada, sin notificaciones).
        const esRegistroHistorico = isAdmin(req.user) && data.esRegistroHistorico === true;
        if (!data.pronosticoMeteorologico?.trim()) {
            res.status(400).json({ error: 'El pronóstico meteorológico es obligatorio' });
            return;
        }
        // Un usuario no-admin nunca puede marcar una salida como registro histórico.
        if (!isAdmin(req.user) && data.esRegistroHistorico) {
            res.status(403).json({ error: 'No tienes permiso para crear registros históricos' });
            return;
        }
        const errorFecha = errorFechaCalendario('Fecha de inicio', data.fechaInicio) ??
            errorFechaCalendario('Fecha de retorno', data.fechaRetornoEstimada);
        if (errorFecha) {
            res.status(400).json({ error: errorFecha });
            return;
        }
        // Las fechas pasadas solo se permiten en registros históricos del admin.
        if (!esRegistroHistorico) {
            const todayStr = new Date().toISOString().split('T')[0];
            const fechaInicioStr = String(data.fechaInicio).slice(0, 10);
            if (fechaInicioStr < todayStr) {
                res.status(400).json({ error: 'No se puede crear una salida con fecha de inicio en el pasado' });
                return;
            }
        }
        const participantesNormalizados = normalizeParticipantes(data.participantes ?? [], req.user.email ?? data.liderCordada ?? null);
        const organizationId = req.user.organizationId;
        // numeroSalida es un correlativo por club, no una secuencia global de
        // Postgres: se asigna dentro de una transacción interactiva que primero
        // incrementa organizations.ultimo_numero_salida. El UPDATE toma un lock de
        // fila sobre esa organización (row lock implícito de Postgres), así que
        // dos creaciones concurrentes del mismo club se serializan y ninguna ve el
        // mismo valor; clubes distintos no se bloquean entre sí porque bloquean
        // filas distintas.
        const salida = await prisma.$transaction(async (tx) => {
            const organization = await tx.organization.update({
                where: { id: organizationId },
                data: { ultimoNumeroSalida: { increment: 1 } },
                select: { ultimoNumeroSalida: true },
            });
            return tx.salida.create({
                data: {
                    organizationId,
                    numeroSalida: organization.ultimoNumeroSalida,
                    userId,
                    creatorEmail: req.user.email,
                    tipoSalida: data.tipoSalida,
                    disciplina: data.disciplina,
                    temporada: data.temporada,
                    nombreActividad: data.nombreActividad,
                    ubicacionGeografica: data.ubicacionGeografica,
                    fechaInicio: new Date(data.fechaInicio),
                    horaInicio: data.horaInicio || null,
                    fechaRetornoEstimada: new Date(data.fechaRetornoEstimada),
                    horaRetornoEstimada: data.horaRetornoEstimada,
                    horaAlerta: data.horaAlerta,
                    avisosExternos: asJson(data.avisosExternos ?? []),
                    retenCarabineros: data.retenCarabineros || null,
                    nombreFamiliar: data.nombreFamiliar || null,
                    telefonoFamiliar: data.telefonoFamiliar || null,
                    liderCordada: data.liderCordada,
                    participantes: asJson(participantesNormalizados),
                    coordinacionGrupal: data.coordinacionGrupal ?? false,
                    matrizRiesgos: data.matrizRiesgos ?? false,
                    mediosComunicacion: asJson(data.mediosComunicacion ?? []),
                    idDispositivoFrecuencia: data.idDispositivoFrecuencia,
                    equipoColectivo: asJson(data.equipoColectivo ?? []),
                    equipoColectivoOtro: data.equipoColectivoOtro,
                    pronosticoMeteorologico: data.pronosticoMeteorologico,
                    riesgosIdentificados: asJson(data.riesgosIdentificados ?? []),
                    riesgosOtro: data.riesgosOtro,
                    planEvacuacion: data.planEvacuacion,
                    // gpxFileUrl/gpxFileId/gpxFileName nunca se aceptan aquí: solo los
                    // escribe el endpoint dedicado de subida (POST /:id/gpx), después de
                    // crear la salida.
                    status: data.status ?? 'EN_CURSO',
                    incidentReport: data.incidentReport,
                    esRegistroHistorico,
                },
            });
        });
        res.status(201).json(serializeSalida(salida));
        // Los registros históricos del admin no notifican a los integrantes.
        if (!esRegistroHistorico) {
            sendSalidaParticipantEmails(participantesNormalizados, salida, req.user.organization).catch((err) => console.error('[salida-email]', err));
        }
    }
    catch (error) {
        console.error('[createSalida]', error);
        res.status(500).json({ error: 'No se pudo crear la salida' });
    }
}
export async function getSalidas(req, res) {
    try {
        const userId = req.user.id;
        const userEmail = req.user.email;
        // El admin ve todas las salidas (incluidas COMPLETADAS) para poder
        // revisar evaluaciones y cierres de cualquier líder.
        // _count.cierres allows the AdminPanel to detect open salidas without a cierre.
        if (isAdmin(req.user)) {
            const salidas = await prisma.salida.findMany({
                orderBy: { createdAt: 'desc' },
                include: { _count: { select: { cierres: true } } },
            });
            res.json(salidas.map(serializeSalida));
            return;
        }
        let userRut = null;
        if (userEmail) {
            const integrante = await prisma.integrante.findFirst({
                where: { email: userEmail },
                select: { rut: true },
            });
            if (integrante) {
                userRut = integrante.rut;
            }
        }
        // Históricos: el desplegable del Dashboard pide ?historico=true para ver
        // las salidas ya cerradas (COMPLETADA) en las que el usuario participó.
        // Sin el flag se mantiene el comportamiento actual: solo salidas EN_CURSO.
        const historico = req.query['historico'] === 'true' || req.query['historico'] === '1';
        const whereClause = {
            status: historico ? 'COMPLETADA' : 'EN_CURSO',
            OR: [
                { userId: userId },
            ],
        };
        if (userRut) {
            whereClause.OR.push({
                participantes: {
                    array_contains: [{ rut: userRut }],
                },
            });
        }
        const salidas = await prisma.salida.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
        });
        res.json(salidas.map(serializeSalida));
    }
    catch (error) {
        console.error('[getSalidas]', error);
        res.status(500).json({ error: 'No se pudieron obtener las salidas' });
    }
}
/**
 * Regla de visibilidad del detalle de una salida: el admin, el dueño, o un
 * participante registrado (por RUT) pueden verla. Una salida sin dueño
 * (userId null) no es visible para cualquiera: solo el admin o un
 * participante. Compartida por getSalidaById y GET
 * /:id/archivos/:tipo/url — misma regla, un solo lugar.
 */
async function puedeVerSalida(user, salida) {
    if (puedeGestionarSalida(user, salida))
        return true;
    const requestUserEmail = user?.email;
    if (!requestUserEmail)
        return false;
    const integrante = await prisma.integrante.findFirst({
        where: { email: requestUserEmail },
        select: { rut: true },
    });
    if (!integrante?.rut)
        return false;
    const parts = (salida.participantes ?? []);
    return parts.some((p) => p.rut === integrante.rut);
}
export async function getSalidaById(req, res) {
    try {
        const id = req.params.id;
        const salida = await prisma.salida.findUnique({
            where: { id },
            include: { user: { select: { name: true, email: true } } },
        });
        if (!salida) {
            res.status(404).json({ error: 'Salida no encontrada' });
            return;
        }
        if (!(await puedeVerSalida(req.user, salida))) {
            res.status(403).json({ error: 'No tienes permiso para ver esta salida' });
            return;
        }
        res.json(serializeSalida(salida));
    }
    catch (error) {
        console.error('[getSalidaById]', error);
        res.status(500).json({ error: 'No se pudo obtener la salida' });
    }
}
/**
 * GET /api/salidas/:id/archivos/:tipo/url — URL de descarga firmada (10
 * minutos) del GPX o el pronóstico de una salida. Misma regla de acceso que
 * GET /:id (puedeVerSalida).
 */
export async function getSalidaArchivoUrl(req, res) {
    res.set('Cache-Control', 'no-store');
    const id = req.params.id;
    const tipo = req.params.tipo;
    if (tipo !== 'gpx' && tipo !== 'pronostico') {
        res.status(400).json({ error: 'Tipo de archivo inválido' });
        return;
    }
    const tipoArchivo = tipo;
    try {
        const salida = await prisma.salida.findUnique({ where: { id } });
        if (!salida) {
            res.status(404).json({ error: 'Salida no encontrada' });
            return;
        }
        if (!(await puedeVerSalida(req.user, salida))) {
            res.status(403).json({ error: 'No tienes permiso para ver esta salida' });
            return;
        }
        const fileId = tipoArchivo === 'gpx' ? salida.gpxFileId : salida.pronosticoFileId;
        const legacyUrl = tipoArchivo === 'gpx' ? salida.gpxFileUrl : salida.pronosticoFileUrl;
        const fileName = tipoArchivo === 'gpx' ? salida.gpxFileName : salida.pronosticoFileName;
        const downloadName = fileName ?? `${tipoArchivo}-${salida.numeroSalida}`;
        const resolution = resolveFileDownload({ fileId, legacyUrl, downloadName }, req.user.organizationId);
        switch (resolution.kind) {
            case 'absent':
                res.status(404).json({ error: 'La salida no tiene ese archivo' });
                return;
            case 'mismatch':
                console.error(`[getSalidaArchivoUrl] clave ${resolution.key} no pertenece al club solicitante`);
                res.status(404).json({ error: 'La salida no tiene ese archivo' });
                return;
            case 'legacy':
                res.json({ url: resolution.url, expiresInSeconds: null });
                return;
            case 'signed': {
                const url = await getFileStorage().createSignedDownloadUrl(resolution.key, {
                    expiresInSeconds: ARCHIVO_DOWNLOAD_SECONDS,
                    downloadName: resolution.downloadName,
                });
                res.json({ url, expiresInSeconds: ARCHIVO_DOWNLOAD_SECONDS });
                return;
            }
        }
    }
    catch (error) {
        console.error('[getSalidaArchivoUrl]', error);
        res.status(500).json({ error: 'No se pudo generar el enlace de descarga' });
    }
}
export async function updateSalida(req, res) {
    try {
        const id = req.params.id;
        const existing = await prisma.salida.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Salida no encontrada' });
            return;
        }
        // Solo el dueño o el administrador pueden editar una salida. Una salida
        // sin dueño (userId null) queda reservada al admin.
        if (!puedeGestionarSalida(req.user, existing)) {
            res.status(403).json({ error: 'No tienes permiso para modificar esta salida' });
            return;
        }
        // Solo se pueden editar salidas en curso (no cerradas, canceladas, etc.).
        if (existing.status !== 'EN_CURSO') {
            res.status(409).json({ error: 'Solo se pueden editar salidas en curso' });
            return;
        }
        // Whitelist explícita — nunca exponer campos de sistema al cliente
        const body = req.body;
        const errorFecha = (body.fechaInicio !== undefined ? errorFechaCalendario('Fecha de inicio', body.fechaInicio) : null) ??
            (body.fechaRetornoEstimada !== undefined
                ? errorFechaCalendario('Fecha de retorno', body.fechaRetornoEstimada)
                : null);
        if (errorFecha) {
            res.status(400).json({ error: errorFecha });
            return;
        }
        const salida = await prisma.salida.update({
            where: { id },
            data: {
                ...(body.tipoSalida !== undefined && { tipoSalida: body.tipoSalida }),
                ...(body.disciplina !== undefined && { disciplina: body.disciplina }),
                ...(body.temporada !== undefined && { temporada: body.temporada }),
                ...(body.nombreActividad !== undefined && { nombreActividad: body.nombreActividad }),
                ...(body.ubicacionGeografica !== undefined && { ubicacionGeografica: body.ubicacionGeografica }),
                ...(body.fechaInicio !== undefined && { fechaInicio: new Date(body.fechaInicio) }),
                ...(body.horaInicio !== undefined && { horaInicio: body.horaInicio || null }),
                ...(body.fechaRetornoEstimada !== undefined && { fechaRetornoEstimada: new Date(body.fechaRetornoEstimada) }),
                ...(body.horaRetornoEstimada !== undefined && { horaRetornoEstimada: body.horaRetornoEstimada }),
                ...(body.horaAlerta !== undefined && { horaAlerta: body.horaAlerta }),
                ...(body.avisosExternos !== undefined && { avisosExternos: asJson(body.avisosExternos) }),
                ...(body.retenCarabineros !== undefined && { retenCarabineros: body.retenCarabineros || null }),
                ...(body.nombreFamiliar !== undefined && { nombreFamiliar: body.nombreFamiliar || null }),
                ...(body.telefonoFamiliar !== undefined && { telefonoFamiliar: body.telefonoFamiliar || null }),
                // `liderCordada` y `participantes` (grupo humano) NO son editables por este endpoint.
                ...(body.coordinacionGrupal !== undefined && { coordinacionGrupal: body.coordinacionGrupal }),
                ...(body.matrizRiesgos !== undefined && { matrizRiesgos: body.matrizRiesgos }),
                ...(body.mediosComunicacion !== undefined && { mediosComunicacion: asJson(body.mediosComunicacion) }),
                ...(body.idDispositivoFrecuencia !== undefined && { idDispositivoFrecuencia: body.idDispositivoFrecuencia }),
                ...(body.equipoColectivo !== undefined && { equipoColectivo: asJson(body.equipoColectivo) }),
                ...(body.equipoColectivoOtro !== undefined && { equipoColectivoOtro: body.equipoColectivoOtro }),
                ...(body.pronosticoMeteorologico !== undefined && { pronosticoMeteorologico: body.pronosticoMeteorologico }),
                ...(body.riesgosIdentificados !== undefined && { riesgosIdentificados: asJson(body.riesgosIdentificados) }),
                ...(body.riesgosOtro !== undefined && { riesgosOtro: body.riesgosOtro }),
                ...(body.planEvacuacion !== undefined && { planEvacuacion: body.planEvacuacion }),
                // `status` NO es editable acá: la transición a COMPLETADA ocurre solo al crear el cierre.
                ...(body.incidentReport !== undefined && { incidentReport: body.incidentReport }),
            },
        });
        res.json(serializeSalida(salida));
    }
    catch (error) {
        console.error('[updateSalida]', error);
        res.status(500).json({ error: 'No se pudo actualizar la salida' });
    }
}
/**
 * PUT /api/salidas/:id/integrantes
 *
 * Edita el apartado de integrantes (participantes + líder) de una salida.
 * Permitido solo para admin o el dueño, mientras la salida esté EN_CURSO y la
 * fecha+hora de salida todavía no se haya alcanzado. Deja un registro de
 * auditoría con cada cambio y notifica solo a los recién agregados.
 */
export async function updateSalidaIntegrantes(req, res) {
    try {
        const id = req.params.id;
        const requestUserEmail = req.user.email;
        const existing = await prisma.salida.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Salida no encontrada' });
            return;
        }
        // Solo el dueño o el administrador pueden editar los integrantes. Una
        // salida sin dueño (userId null) queda reservada al admin.
        if (!puedeGestionarSalida(req.user, existing)) {
            res.status(403).json({ error: 'No tienes permiso para modificar esta salida' });
            return;
        }
        if (existing.status !== 'EN_CURSO') {
            res.status(409).json({ error: 'Solo se pueden editar salidas en curso' });
            return;
        }
        // Gate de fecha+hora de salida: una vez alcanzada, queda en solo lectura.
        if (!isIntegrantesEditable(existing, new Date())) {
            res.status(409).json({
                error: 'La edición de integrantes ya no está disponible porque la salida ya comenzó o la hora programada de salida ya fue alcanzada.',
            });
            return;
        }
        const body = req.body;
        if (!Array.isArray(body.participantes)) {
            res.status(400).json({ error: 'participantes es obligatorio' });
            return;
        }
        const addedBy = requestUserEmail ?? existing.liderCordada;
        const prevParticipantes = existing.participantes ?? [];
        const nextParticipantes = normalizeParticipantes(body.participantes, addedBy);
        const auditEntries = diffIntegrantesAudit(prevParticipantes, nextParticipantes, addedBy);
        const prevLog = Array.isArray(existing.integrantesAuditLog)
            ? existing.integrantesAuditLog
            : [];
        const nextLog = [...prevLog, ...auditEntries];
        const salida = await prisma.salida.update({
            where: { id },
            data: {
                participantes: asJson(nextParticipantes),
                ...(typeof body.liderCordada === 'string' && body.liderCordada.trim()
                    ? { liderCordada: body.liderCordada }
                    : {}),
                integrantesAuditLog: asJson(nextLog),
            },
        });
        res.json(serializeSalida(salida));
        // Notificar solo a los recién agregados (no re-enviar a los ya existentes).
        const prevRuts = new Set(prevParticipantes.filter((p) => p?.rut).map((p) => p.rut));
        const added = nextParticipantes.filter((p) => p?.rut && !prevRuts.has(p.rut));
        if (added.length > 0) {
            sendSalidaParticipantEmails(added, salida, req.user.organization).catch((err) => console.error('[salida-email]', err));
        }
    }
    catch (error) {
        console.error('[updateSalidaIntegrantes]', error);
        res.status(500).json({ error: 'No se pudieron actualizar los integrantes' });
    }
}
export async function deleteSalida(req, res) {
    try {
        const id = req.params.id;
        const requestUserId = req.user.id;
        const existing = await prisma.salida.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Salida no encontrada' });
            return;
        }
        // Regla propia (no usa puedeGestionarSalida): una salida con dueño solo la
        // borra su dueño, nunca el admin; una sin dueño (legada) queda reservada
        // al admin.
        const puedeBorrar = existing.userId === null ? isAdmin(req.user) : existing.userId === requestUserId;
        if (!puedeBorrar) {
            res.status(403).json({ error: 'No tienes permiso para eliminar esta salida' });
            return;
        }
        await prisma.salida.delete({ where: { id } });
        res.status(204).send();
        // Best-effort, después de responder: un id legado de Drive se ignora en
        // silencio (Drive ya no existe) — ver el helper.
        deleteStoredFileBestEffort(existing.gpxFileId, 'deleteSalida');
        deleteStoredFileBestEffort(existing.pronosticoFileId, 'deleteSalida');
    }
    catch (error) {
        console.error('[deleteSalida]', error);
        res.status(500).json({ error: 'No se pudo eliminar la salida' });
    }
}
