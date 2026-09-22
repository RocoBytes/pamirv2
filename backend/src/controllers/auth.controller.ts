import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { sendClubEmail } from '../lib/email/club-email.js';
import { buildPasswordResetEmail, brandingFor } from '../lib/email-templates.js';
import { subjectPasswordReset } from '../lib/email/subjects.js';
import { emailField, passwordField, SALT_ROUNDS } from '../lib/auth-fields.js';
import { FRONTEND_URL } from '../lib/config.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import { isOrganizationSuspended, CLUB_SUSPENDIDO_MENSAJE } from '../lib/organization-status.js';
import { toPublicOrganization } from '../lib/serializers/organization.js';

const loginSchema = z.object({ email: emailField, password: z.string().min(1, 'Contraseña requerida') });
const forgotSchema = z.object({ email: emailField });
const resetSchema = z.object({ token: z.string().uuid('Token inválido'), password: passwordField });

// ─── Verify email ─────────────────────────────────────────────────────────────

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const token = req.params['token'] as string;

  try {
    // El token de verificación identifica la cuenta por sí solo (todavía no se
    // sabe a qué club pertenece), así que este flujo corre en contexto de plataforma.
    await runAsPlatform(async () => {
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
    });
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
    // El email es único en toda la plataforma (todavía no se sabe a qué club
    // pertenece la cuenta), así que la búsqueda corre en contexto de plataforma.
    const user = await runAsPlatform(() =>
      prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: {
          organization: {
            select: { id: true, slug: true, name: true, shortName: true, status: true, membresiaPropia: true },
          },
        },
      }),
    );

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

    if (isOrganizationSuspended(user.organization.status)) {
      res.status(403).json({ error: CLUB_SUSPENDIDO_MENSAJE });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email });
    // gestorCategoriasDe consulta un modelo de tenant (GestorCategoria): corre
    // ya dentro del contexto del club del usuario autenticado.
    const gestorCategorias = await runWithOrganization(user.organizationId, () => gestorCategoriasDe(user.id));

    res.json({
      token,
      user: {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        name: user.name,
        picture: user.picture ?? undefined,
        rol: user.rol,
        gestorCategorias,
        organization: toPublicOrganization(user.organization),
      },
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
    const { id, organizationId, email, name, rol, organization } = req.user!;
    const gestorCategorias = await gestorCategoriasDe(id);
    res.json({
      user: { id, organizationId, email, name, rol, gestorCategorias, organization: toPublicOrganization(organization) },
    });
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
    // El email es único en toda la plataforma, así que este flujo corre en
    // contexto de plataforma. El correo se envía "como" el club del usuario
    // encontrado (se carga en la misma búsqueda) usando el proveedor
    // transaccional — ya no depende de ningún contexto de tenant ambiente.
    await runAsPlatform(async () => {
      const found = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: {
          organization: {
            select: {
              id: true,
              slug: true,
              name: true,
              shortName: true,
              membresiaPropia: true,
              alertEmail: true,
              contactName: true,
              contactEmail: true,
            },
          },
        },
      });
      if (!found) return;

      const resetToken = randomUUID();
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await prisma.user.update({
        where: { id: found.id },
        data: { resetToken, resetTokenExpiry },
      });

      const resetUrl = `${FRONTEND_URL}?reset=${resetToken}`;
      const branding = brandingFor(found.organization);
      sendClubEmail(found.organization, {
        to: normalizedEmail,
        subject: subjectPasswordReset(branding),
        html: buildPasswordResetEmail(found.name, resetUrl, branding),
        kind: 'notificacion',
      }).catch((err) => console.error('[forgotPassword] email error:', err));
    });

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
    // El token de restablecimiento identifica la cuenta por sí solo, así que
    // este flujo corre en contexto de plataforma.
    const ok = await runAsPlatform(async () => {
      const user = await prisma.user.findUnique({ where: { resetToken: token } });

      if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
        return false;
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

      return true;
    });

    if (!ok) {
      res.status(400).json({ error: 'El enlace de restablecimiento es inválido o ha expirado' });
      return;
    }

    res.json({ message: 'Contraseña actualizada correctamente. Ahora puedes iniciar sesión.' });
  } catch (error) {
    console.error('[resetPassword]', error);
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
}
