// CLI para crear o actualizar usuarios sin depender del registro público
// (que se retirará en una fase posterior). Nunca acepta la contraseña por
// flag: siempre se pide de forma interactiva para no dejarla en el
// historial de la shell ni en los logs del proceso.
import 'dotenv/config';
import { createInterface } from 'node:readline';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { verifyDbTargetOrExit as guardVerifyDbTargetOrExit } from '../lib/db-target-guard.js';
import { passwordField, SALT_ROUNDS } from '../lib/auth-fields.js';
import { parseCreateUserArgs } from './create-user-args.js';
import { runAsPlatform } from '../lib/tenant-context.js';

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = '\b';
const DELETE = String.fromCharCode(127);

// Defensa en profundidad: npm run db:create-user ya ejecuta el guard como
// pre-hook, pero este script también puede invocarse directamente con tsx.
// ALLOW_ANY_DB_TARGET=1 lo desactiva para el contenedor de producción, donde
// backend/db-target.json no aplica (ahí la protección es el propio entorno).
function verifyDbTargetOrExit(): void {
  guardVerifyDbTargetOrExit({
    prefix: '[create-user]',
    honorAllowAny: true,
    failureMessage:
      '[create-user] Comando abortado: DATABASE_URL no coincide con la base de datos de v2 declarada en ' +
      'backend/db-target.json. Si esto corre en el contenedor de producción, define ALLOW_ANY_DB_TARGET=1.',
  });
}

// Pide una línea con el eco desactivado (para no mostrar la contraseña en
// la terminal). Solo funciona sobre una TTY real. En modo raw un mismo
// evento 'data' puede traer varios caracteres (por ejemplo, al pegar desde
// un gestor de contraseñas), así que se procesa carácter por carácter.
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let input = '';
    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\n' || char === '\r' || char === CTRL_D) {
          finish();
          resolve(input);
          return;
        }
        if (char === CTRL_C) {
          finish();
          process.exit(1);
        }
        if (char === BACKSPACE || char === DELETE) {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    };
    stdin.on('data', onData);
  });
}

// Lee una sola línea de stdin cuando no hay TTY (por ejemplo, stdin viene
// de un pipe). No se puede ocultar el eco en ese caso.
function readLineFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin });
    let resolved = false;
    rl.once('line', (line) => {
      resolved = true;
      rl.close();
      resolve(line);
    });
    rl.once('close', () => {
      if (!resolved) {
        resolve('');
      }
    });
    rl.on('error', reject);
  });
}

// Devuelve la contraseña ya confirmada, o null si las dos entradas no
// coinciden (solo aplica cuando se pide dos veces, en modo TTY).
async function readPassword(): Promise<string | null> {
  if (process.stdin.isTTY) {
    const first = await promptHidden('Contraseña: ');
    const second = await promptHidden('Confirma la contraseña: ');
    if (first !== second) {
      console.error('[create-user] Las contraseñas no coinciden.');
      return null;
    }
    return first;
  }

  return readLineFromStdin();
}

// Script administrativo: opera sobre cualquier club (busca la organización
// por slug, puede crear o actualizar un usuario de esa organización), así que
// corre siempre en contexto de plataforma.
function main(): Promise<void> {
  return runAsPlatform(run);
}

async function run(): Promise<void> {
  verifyDbTargetOrExit();

  const parsed = parseCreateUserArgs(process.argv.slice(2));
  if (!parsed.success) {
    for (const error of parsed.errors) {
      console.error(`[create-user] ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  const { email, name, rol, force, org } = parsed.data;

  const organization = await prisma.organization.findUnique({ where: { slug: org } });
  if (!organization) {
    console.error(`[create-user] No existe ninguna organización con slug="${org}".`);
    process.exitCode = 1;
    return;
  }

  // Se comprueba antes de pedir la contraseña para no hacerla teclear en vano.
  const existing = await prisma.user.findUnique({ where: { email } });

  // Multi-club (ver docs/superpowers/specs/2026-09-23-multi-club-membership-design.md,
  // Ruling 2 del plan de la PR de backend): una cuenta existente puede no
  // tener todavía membresía en ESTE club.
  const existingMembresia = existing
    ? await prisma.membresia.findUnique({
        where: { organizationId_usuarioId: { organizationId: organization.id, usuarioId: existing.id } },
      })
    : null;

  if (existingMembresia && !force) {
    console.error(`[create-user] "${email}" ya es socio de "${org}". Usa --force para actualizarlo.`);
    process.exitCode = 1;
    return;
  }

  // Alta de membresía en un club nuevo para una cuenta ya existente: siempre
  // aditivo (nunca pisa nombre/contraseña de la cuenta compartida), así que
  // no hace falta --force ni pedir contraseña.
  if (existing && !existingMembresia) {
    await prisma.membresia.create({
      data: { organizationId: organization.id, usuarioId: existing.id, rol },
    });
    console.log(`[create-user] Se agregó a "${email}" como socio de "${org}" con rol="${rol}".`);
    return;
  }

  const rawPassword = await readPassword();
  if (rawPassword === null) {
    process.exitCode = 1;
    return;
  }

  const passwordResult = passwordField.safeParse(rawPassword);
  if (!passwordResult.success) {
    console.error(`[create-user] ${passwordResult.error.issues[0]?.message ?? 'Contraseña inválida'}`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(passwordResult.data, SALT_ROUNDS);

  if (!existing) {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { organizationId: organization.id, email, name, passwordHash, rol, emailVerified: true },
      });
      await tx.membresia.create({
        data: { organizationId: organization.id, usuarioId: user.id, rol },
      });
    });
    console.log(`[create-user] Usuario creado: email="${email}" rol="${rol}" org="${org}"`);
    return;
  }

  // existing && existingMembresia && force: actualiza el perfil compartido
  // de la cuenta y el rol de ESTA membresía.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { email },
      data: {
        name,
        passwordHash,
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null,
        resetToken: null,
        resetTokenExpiry: null,
        // Columna heredada de User (fase de expansión, ver schema.prisma):
        // solo se actualiza cuando este club sigue siendo el club
        // "primario" de la cuenta (User.organizationId) — igual que
        // updateUserRol en admin.controller.ts.
        ...(existing.organizationId === organization.id ? { rol } : {}),
      },
    });
    // upsert (no update): --force es una herramienta de reparación operativa
    // (ver su descripción en create-user-args.ts, "actualizarlo") — a
    // diferencia de PATCH /admin/users/:id/rol (admin.controller.ts), que
    // falla ruidoso si la Membresia falta, acá se prefiere autosanar: una
    // fila que falte (backfill incompleto, borrado a mano) no debe bloquear
    // al operador que está tratando de arreglar justamente ese usuario.
    await tx.membresia.upsert({
      where: { organizationId_usuarioId: { organizationId: organization.id, usuarioId: user.id } },
      create: { organizationId: organization.id, usuarioId: user.id, rol },
      update: { rol },
    });
  });
  console.log(`[create-user] Usuario actualizado: email="${email}" rol="${rol}" org="${org}"`);
}

main()
  .catch((error: unknown) => {
    console.error('[create-user] Error inesperado:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // El adaptador pg crea su propio Pool a partir del connection string
    // (ver src/lib/prisma.ts); $disconnect() lo cierra para que el proceso
    // no quede colgado esperando conexiones abiertas.
    await prisma.$disconnect();
  });
