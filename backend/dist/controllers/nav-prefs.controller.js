import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
// Reutiliza la tabla dashboard_layouts, que ya guarda preferencias por usuario
// discriminadas por dashboardKey: agregar una superficie personalizable más no
// necesita modelo nuevo ni migración.
const NAV_DASHBOARD_KEY = 'nav';
// El servidor es la autoridad sobre qué se puede guardar. Estas listas tienen
// que seguir a las del frontend (shell/navItems.ts y dashboard/QuickAccess.tsx):
// una clave que no esté acá se descarta en silencio, así que una preferencia
// vieja nunca revive un destino que ya no existe.
const TAB_KEYS = ['inicio', 'eventos', 'documentos', 'contactos'];
const QUICK_KEYS = ['contactos', 'eventos', 'documentos', 'admin', 'invitar', 'integrante'];
/**
 * Destinos que no se pueden quitar.
 *
 * "contactos" es el acceso a Socorro Andino y al resto de los teléfonos de
 * emergencia. Dejar que alguien se lo saque de la barra sería convertir una
 * preferencia estética en un riesgo: la app se usa en montaña y ese acceso
 * tiene que estar donde siempre. "inicio" queda fijo porque es la raíz de la
 * navegación y sin él no hay forma de volver.
 *
 * Se aplica en el servidor y no solo en la interfaz: un payload manipulado, o
 * uno guardado por una versión anterior del cliente, tampoco puede sacarlos.
 */
const PINNED_TABS = ['inicio', 'contactos'];
const navPreferencesSchema = z.object({
    tabs: z.array(z.string()).max(20),
    quick: z.array(z.string()).max(20),
});
/** Quita desconocidos y repetidos conservando el orden pedido. */
function keepKnown(requested, allowed) {
    const seen = new Set();
    return requested.filter((key) => allowed.includes(key) && !seen.has(key) && (seen.add(key), true));
}
/**
 * Normaliza lo que llega del cliente a algo que siempre se puede renderizar.
 *
 * Es pura a propósito: la regla que garantiza el acceso a emergencias se puede
 * probar sin base de datos ni servidor.
 */
export function sanitizeNavPreferences(input) {
    const tabs = keepKnown(input.tabs, TAB_KEYS);
    // Reponer los fijos que falten, en su lugar natural: inicio abre la barra y
    // contactos la cierra, que es donde el pulgar los busca.
    for (const pinned of PINNED_TABS) {
        if (tabs.includes(pinned))
            continue;
        if (pinned === 'inicio')
            tabs.unshift(pinned);
        else
            tabs.push(pinned);
    }
    return { tabs, quick: keepKnown(input.quick, QUICK_KEYS) };
}
// GET /api/me/nav-preferences
export async function getNavPreferences(req, res) {
    try {
        const userId = req.user.id;
        const row = await prisma.dashboardLayout.findUnique({
            where: { userId_dashboardKey: { userId, dashboardKey: NAV_DASHBOARD_KEY } },
        });
        // null (y no un valor por defecto) para que el cliente distinga "nunca
        // personalizó" de "personalizó y dejó esto": el orden por defecto vive en
        // el frontend y puede cambiar sin tocar lo guardado.
        if (!row) {
            res.json({ preferences: null });
            return;
        }
        res.json({ preferences: row.layout, updatedAt: row.updatedAt });
    }
    catch (error) {
        console.error('[getNavPreferences]', error);
        res.status(500).json({ error: 'No se pudo obtener la configuración de navegación' });
    }
}
// PUT /api/me/nav-preferences
export async function saveNavPreferences(req, res) {
    try {
        const parsed = navPreferencesSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Configuración de navegación inválida' });
            return;
        }
        const preferences = sanitizeNavPreferences(parsed.data);
        const userId = req.user.id;
        const saved = await prisma.dashboardLayout.upsert({
            where: { userId_dashboardKey: { userId, dashboardKey: NAV_DASHBOARD_KEY } },
            create: {
                organizationId: req.user.organizationId,
                userId,
                dashboardKey: NAV_DASHBOARD_KEY,
                layout: preferences,
            },
            update: { layout: preferences },
        });
        res.json({ preferences: saved.layout, updatedAt: saved.updatedAt });
    }
    catch (error) {
        console.error('[saveNavPreferences]', error);
        res.status(500).json({ error: 'No se pudo guardar la configuración de navegación' });
    }
}
// DELETE /api/me/nav-preferences — vuelve al orden por defecto.
export async function deleteNavPreferences(req, res) {
    try {
        await prisma.dashboardLayout.deleteMany({
            where: { userId: req.user.id, dashboardKey: NAV_DASHBOARD_KEY },
        });
        res.json({ preferences: null });
    }
    catch (error) {
        console.error('[deleteNavPreferences]', error);
        res.status(500).json({ error: 'No se pudo restablecer la configuración de navegación' });
    }
}
