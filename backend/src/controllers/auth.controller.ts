import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { sendEmail } from '../lib/google-gmail.js';
import { buildVerificationEmail, buildPasswordResetEmail } from '../lib/email-templates.js';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
const SALT_ROUNDS = 12;

const emailField = z.string().trim().email('Formato de email inválido').max(254);
const passwordField = z.string()
  .min(8, 'Mínimo 8 caracteres')
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, 'La contraseña es demasiado larga');
const nameField = z.string().trim().min(1, 'El nombre es requerido').max(100, 'Máximo 100 caracteres');

const registerSchema = z.object({ name: nameField, email: emailField, password: passwordField });
const loginSchema = z.object({ email: emailField, password: z.string().min(1, 'Contraseña requerida') });
const forgotSchema = z.object({ email: emailField });
const resetSchema = z.object({ token: z.string().uuid('Token inválido'), password: passwordField });

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    return;
  }
  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  try {
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const verificationToken = randomUUID();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    if (existing) {
      if (existing.passwordHash) {
        res.status(409).json({ error: 'Ya existe una cuenta con ese email. Inicia sesión.' });
        return;
      }
      // Usuario Clerk migrando: asignar contraseña + re-verificar
      await prisma.user.update({
        where: { email: normalizedEmail },
        data: { name: name.trim(), passwordHash, emailVerified: false, verificationToken, verificationTokenExpiry },
      });
    } else {
      await prisma.user.create({
        data: { email: normalizedEmail, name: name.trim(), passwordHash, emailVerified: false, verificationToken, verificationTokenExpiry },
      });
    }

    const verificationUrl = `${BACKEND_URL}/api/auth/verify/${verificationToken}`;
    sendEmail(
      normalizedEmail,
      'Confirma tu cuenta — Pamir',
      buildVerificationEmail(name.trim(), verificationUrl),
    ).catch((err) => console.error('[register] email error:', err));

    res.status(201).json({ message: 'Cuenta creada. Revisa tu correo para verificarla.' });
  } catch (error) {
    console.error('[register]', error);
    res.status(500).json({ error: 'No se pudo crear la cuenta' });
  }
}

// ─── Verify email ─────────────────────────────────────────────────────────────

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const token = req.params['token'] as string;

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
  } catch (error) {
    console.error('[verifyEmail]', error);
    res.redirect(`${FRONTEND_URL}?verified=error`);
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(req: Request, res: Response): Promise<void> {
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
  } catch (error) {
    console.error('[login]', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
}

// ─── Me ───────────────────────────────────────────────────────────────────────

// Categorías de eventos que el usuario gestiona (vacío para la mayoría)
async function gestorCategoriasDe(userId: string): Promise<{ categoriaId: number; slug: string }[]> {
  const filas = await prisma.gestorCategoria.findMany({
    where: { usuarioId: userId },
    select: { categoriaId: true, categoria: { select: { slug: true } } },
    orderBy: { categoriaId: 'asc' },
  });
  return filas.map((f) => ({ categoriaId: f.categoriaId, slug: f.categoria.slug }));
}

// Usuario autenticado actual. authMiddleware ya lo cargó fresco desde la base
// de datos, por lo que rol siempre refleja el valor vigente.
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const { id, email, name, rol } = req.user!;
    const gestorCategorias = await gestorCategoriasDe(id);
    res.json({ user: { id, email, name, rol, gestorCategorias } });
  } catch (error) {
    console.error('[getMe]', error);
    res.status(500).json({ error: 'Error al obtener el usuario' });
  }
}

// ─── Forgot password ──────────────────────────────────────────────────────────

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    return;
  }
  const { email } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  try {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user && user.passwordHash) {
      const resetToken = randomUUID();
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExpiry },
      });

      const resetUrl = `${FRONTEND_URL}?reset=${resetToken}`;
      sendEmail(
        normalizedEmail,
        'Restablece tu contraseña — Pamir',
        buildPasswordResetEmail(user.name, resetUrl),
      ).catch((err) => console.error('[forgotPassword] email error:', err));
    }

    // Siempre responder 200 para no revelar si el email existe
    res.json({ message: 'Si el email está registrado, recibirás un enlace para restablecer tu contraseña.' });
  } catch (error) {
    console.error('[forgotPassword]', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
}

// ─── Reset password ───────────────────────────────────────────────────────────

export async function resetPassword(req: Request, res: Response): Promise<void> {
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

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiry: null },
    });

    res.json({ message: 'Contraseña actualizada correctamente. Ahora puedes iniciar sesión.' });
  } catch (error) {
    console.error('[resetPassword]', error);
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
}
