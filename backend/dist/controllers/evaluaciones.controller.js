import { prisma } from '../lib/prisma.js';
import { isAdmin } from '../lib/authz.js';
const MAX_COMENTARIO_LENGTH = 2000;
function isNota(v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}
// GET /api/evaluaciones/:token — público: datos mínimos para renderizar el form
export async function getEvaluacion(req, res) {
    try {
        const token = req.params['token'];
        const evalToken = await prisma.evaluacionToken.findUnique({
            where: { token },
            include: { salida: { select: { nombreActividad: true, fechaInicio: true } } },
        });
        if (!evalToken) {
            res.status(404).json({ error: 'Evaluación no encontrada' });
            return;
        }
        res.json({
            nombreActividad: evalToken.salida.nombreActividad,
            fechaInicio: evalToken.salida.fechaInicio,
            used: evalToken.used,
        });
    }
    catch (error) {
        console.error('[getEvaluacion]', error);
        res.status(500).json({ error: 'No se pudo obtener la evaluación' });
    }
}
// POST /api/evaluaciones/:token — público: registra la respuesta anónima.
// El token se marca usado y la respuesta se crea SIN ningún vínculo al token.
export async function submitEvaluacion(req, res) {
    try {
        const token = req.params['token'];
        const body = req.body;
        if (!isNota(body.notaObjetivos) || !isNota(body.notaItinerario) || !isNota(body.notaLider)) {
            res.status(400).json({ error: 'Las notas deben ser números enteros entre 1 y 5' });
            return;
        }
        const comentario = typeof body.comentario === 'string' ? body.comentario.trim() : '';
        if (comentario.length > MAX_COMENTARIO_LENGTH) {
            res.status(400).json({ error: `El comentario no puede superar los ${MAX_COMENTARIO_LENGTH} caracteres` });
            return;
        }
        const evalToken = await prisma.evaluacionToken.findUnique({ where: { token } });
        if (!evalToken) {
            res.status(404).json({ error: 'Evaluación no encontrada' });
            return;
        }
        if (evalToken.used) {
            res.status(409).json({ error: 'Esta evaluación ya fue respondida' });
            return;
        }
        // updateMany con guard `used: false` evita doble envío concurrente
        await prisma.$transaction(async (tx) => {
            const marked = await tx.evaluacionToken.updateMany({
                where: { id: evalToken.id, used: false },
                data: { used: true },
            });
            if (marked.count === 0) {
                throw new Error('TOKEN_ALREADY_USED');
            }
            await tx.evaluacionRespuesta.create({
                data: {
                    salidaId: evalToken.salidaId,
                    notaObjetivos: body.notaObjetivos,
                    notaItinerario: body.notaItinerario,
                    notaLider: body.notaLider,
                    comentario: comentario || null,
                },
            });
        });
        res.status(201).json({ ok: true });
    }
    catch (error) {
        if (error instanceof Error && error.message === 'TOKEN_ALREADY_USED') {
            res.status(409).json({ error: 'Esta evaluación ya fue respondida' });
            return;
        }
        console.error('[submitEvaluacion]', error);
        res.status(500).json({ error: 'No se pudo registrar la evaluación' });
    }
}
// GET /api/evaluaciones/resultados/:salidaId — solo admin
export async function getResultados(req, res) {
    try {
        if (!isAdmin(req.user)) {
            res.status(403).json({ error: 'No tienes permiso para ver los resultados' });
            return;
        }
        const salidaId = req.params['salidaId'];
        const salida = await prisma.salida.findUnique({
            where: { id: salidaId },
            select: { id: true },
        });
        if (!salida) {
            res.status(404).json({ error: 'Salida no encontrada' });
            return;
        }
        const [totalTokens, respuestas] = await prisma.$transaction([
            prisma.evaluacionToken.count({ where: { salidaId } }),
            prisma.evaluacionRespuesta.findMany({
                where: { salidaId },
                select: { notaObjetivos: true, notaItinerario: true, notaLider: true, comentario: true },
            }),
        ]);
        const totalRespuestas = respuestas.length;
        const avg = (pick) => totalRespuestas === 0
            ? 0
            : Math.round((respuestas.reduce((acc, r) => acc + pick(r), 0) / totalRespuestas) * 10) / 10;
        // Orden aleatorio: evita correlacionar comentarios con el orden de envío de emails
        const comentarios = respuestas
            .map((r) => r.comentario)
            .filter((c) => Boolean(c))
            .sort(() => Math.random() - 0.5);
        res.json({
            totalTokens,
            totalRespuestas,
            promedios: {
                objetivos: avg((r) => r.notaObjetivos),
                itinerario: avg((r) => r.notaItinerario),
                lider: avg((r) => r.notaLider),
            },
            comentarios,
        });
    }
    catch (error) {
        console.error('[getResultados]', error);
        res.status(500).json({ error: 'No se pudieron obtener los resultados' });
    }
}
