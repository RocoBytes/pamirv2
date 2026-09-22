// CLI para crear o actualizar usuarios sin depender del registro público
// (que se retirará en una fase posterior). Nunca acepta la contraseña por
// flag: siempre se pide de forma interactiva para no dejarla en el
// historial de la shell ni en los logs del proceso.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { describeTarget, isAllowedTarget } from '../lib/db-target.js';
import { passwordField, SALT_ROUNDS } from '../lib/auth-fields.js';
import { parseCreateUserArgs } from './create-user-args.js';

interface DbTargetConfig {
  allowedHostFragment: string;
}

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = '\b';
const DELETE = String.fromCharCode(127);

function loadDbTargetConfig(): DbTargetConfig {
  const raw = readFileSync(new URL('../../db-target.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as DbTargetConfig;
}

// Defensa en profundidad: npm run db:create-user ya ejecuta el guard como
// pre-hook, pero este script también puede invocarse directamente con tsx.
// ALLOW_ANY_DB_TARGET=1 lo desactiva para el contenedor de producción, donde
// backend/db-target.json no aplica (ahí la protección es el propio entorno).
function verifyDbTargetOrExit(): void {
  if (process.env.ALLOW_ANY_DB_TARGET === '1') {
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const config = loadDbTargetConfig();
  const target = describeTarget(databaseUrl ?? '');
  if (target) {
    console.log(`[create-user] DATABASE_URL apunta a host="${target.host}" database="${target.database}"`);
  }

  if (!isAllowedTarget(databaseUrl, config.allowedHostFragment)) {
    console.error(
      '[create-user] Comando abortado: DATABASE_URL no coincide con la base de datos de v2 declarada en ' +
        'backend/db-target.json. Si esto corre en el contenedor de producción, define ALLOW_ANY_DB_TARGET=1.',
    );
    process.exit(1);
  }
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

async function main(): Promise<void> {
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
  if (existing && !force) {
    console.error(`[create-user] Ya existe un usuario con email="${email}". Usa --force para actualizarlo.`);
    process.exitCode = 1;
    return;
  }
  // --force nunca traslada un usuario existente a otro club: solo actualiza
  // su perfil dentro del club al que ya pertenece.
  if (existing && existing.organizationId !== organization.id) {
    console.error(
      `[create-user] El usuario con email="${email}" pertenece a otra organización. ` +
        '--force no puede cambiarlo de club.',
    );
    process.exitCode = 1;
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
    await prisma.user.create({
      data: { organizationId: organization.id, email, name, passwordHash, rol, emailVerified: true },
    });
    console.log(`[create-user] Usuario creado: email="${email}" rol="${rol}" org="${org}"`);
    return;
  }

  await prisma.user.update({
    where: { email },
    data: {
      name,
      passwordHash,
      rol,
      emailVerified: true,
      verificationToken: null,
      verificationTokenExpiry: null,
      resetToken: null,
      resetTokenExpiry: null,
    },
  });
  console.log(`[create-user] Usuario actualizado: email="${email}" rol="${rol}"`);
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
