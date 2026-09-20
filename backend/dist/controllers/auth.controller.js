import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { sendEmail } from '../lib/google-gmail.js';
import { buildPasswordResetEmail } from '../lib/email-templates.js';
import { emailField, passwordField, SALT_ROUNDS } from '../lib/auth-fields.js';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const loginSchema = z.object({ email: emailField, password: z.string().min(1, 'Contraseña requerida') });
const forgotSchema = z.object({ email: emailField });
const resetSchema = z.object({ token: z.string().uuid('Token inválido'), password: passwordField });
// ─── Verify email ─────────────────────────────────────────────────────────────
export async function verifyEmail(req, res) {
    const token = req.params['token'];
    try {
        const user = await prisma.user.findUnique({ where: { verificationToken: token } });
        if (!user || !user.verificationTokenExpiry || user.verificationTokenExpiry < new Date()) {
            res.redirect(`${FRONTEND_URL}?verified=error`);
            return;
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: true, verificationToken: null, verificationTokenExpiry: null },
        });
        res.redirect(`${FRONTEND_URL}?verified=1`);
    }
    catch (error) {
        console.error('[verifyEmail]', error);
        res.redirect(`${FRONTEND_URL}?verified=error`);
    }
}
// ─── Login ────────────────────────────────────────────────────────────────────
export async function login(req, res) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
        return;
    }
    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    try {
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || !user.passwordHash) {
            res.status(401).json({ error: 'Email o contraseña incorrectos' });
            return;
        }
        if (!user.emailVerified) {
            res.status(403).json({ error: 'Debes verificar tu email antes de iniciar sesión. Revisa tu bandeja de entrada.' });
            return;
        }
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            res.status(401).json({ error: 'Email o contraseña incorrectos' });
            return;
        }
        const token = signToken({ userId: user.id, email: user.email });
        const gestorCategorias = await gestorCategoriasDe(user.id);
        res.json({
            token,
            user: { id: user.id, email: user.email, name: user.name, picture: user.picture ?? undefined, rol: user.rol, gestorCategorias },
        });
    }
    catch (error) {
        console.error('[login]', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
}
// ─── Me ───────────────────────────────────────────────────────────────────────
// Categorías de eventos que el usuario gestiona (vacío para la mayoría)
async function gestorCategoriasDe(userId) {
    const filas = await prisma.gestorCategoria.findMany({
        where: { usuarioId: userId },
        select: { categoriaId: true, categoria: { select: { slug: true } } },
        orderBy: { categoriaId: 'asc' },
    });
    return filas.map((f) => ({ categoriaId: f.categoriaId, slug: f.categoria.slug }));
}
// Usuario autenticado actual. authMiddleware ya lo cargó fresco desde la base
// de datos, por lo que rol siempre refleja el valor vigente.
export async function getMe(req, res) {
    try {
        const { id, email, name, rol } = req.user;
        const gestorCategorias = await gestorCategoriasDe(id);
        res.json({ user: { id, email, name, rol, gestorCategorias } });
    }
    catch (error) {
        console.error('[getMe]', error);
        res.status(500).json({ error: 'Error al obtener el usuario' });
    }
}
// ─── Forgot password ──────────────────────────────────────────────────────────
export async function forgotPassword(req, res) {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
        return;
    }
    const { email } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    try {
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (user) {
            const resetToken = randomUUID();
            const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
            await prisma.user.update({
                where: { id: user.id },
                data: { resetToken, resetTokenExpiry },
            });
            const resetUrl = `${FRONTEND_URL}?reset=${resetToken}`;
            sendEmail(normalizedEmail, 'Restablece tu contraseña — Pamir', buildPasswordResetEmail(user.name, resetUrl)).catch((err) => console.error('[forgotPassword] email error:', err));
        }
        // Siempre responder 200 para no revelar si el email existe
        res.json({ message: 'Si el email está registrado, recibirás un enlace para restablecer tu contraseña.' });
    }
    catch (error) {
        console.error('[forgotPassword]', error);
        res.status(500).json({ error: 'Error al procesar la solicitud' });
    }
}
// ─── Reset password ───────────────────────────────────────────────────────────
export async function resetPassword(req, res) {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
        return;
    }
    const { token, password } = parsed.data;
    try {
        const user = await prisma.user.findUnique({ where: { resetToken: token } });
        if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
            res.status(400).json({ error: 'El enlace de restablecimiento es inválido o ha expirado' });
            return;
        }
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        // El enlace de restablecimiento se envió a esa casilla de correo, lo que
        // prueba su titularidad: se aprovecha para verificar el email también.
        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetToken: null,
                resetTokenExpiry: null,
                emailVerified: true,
                verificationToken: null,
                verificationTokenExpiry: null,
            },
        });
        res.json({ message: 'Contraseña actualizada correctamente. Ahora puedes iniciar sesión.' });
    }
    catch (error) {
        console.error('[resetPassword]', error);
        res.status(500).json({ error: 'Error al restablecer la contraseña' });
    }
}
