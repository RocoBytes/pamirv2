import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

// runAsPlatform ve TODOS los clubes sin filtrar: es la única forma de que una
// consulta se escape del aislamiento multi-club. La lista de abajo se
// mantiene deliberadamente corta — agregar un archivo es una decisión
// explícita y revisada acá, nunca un permiso implícito heredado de otro
// import. Todo lo demás sigue el contexto que ya trae el request (o, en
// scripts, el que arma explícitamente cada uno).
const RUN_AS_PLATFORM_ALLOWED_FILES = [
  'src/middleware/auth.middleware.ts',
  'src/controllers/auth.controller.ts',
  'src/controllers/invitaciones.controller.ts',
  'src/controllers/evaluaciones.controller.ts',
  'src/controllers/cron.controller.ts',
  'src/services/invitaciones.repo.prisma.ts',
  'src/scripts/**',
  '**/*.test.ts',
];

export default [
  { ignores: ['dist', 'node_modules', 'src/generated'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: RUN_AS_PLATFORM_ALLOWED_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/tenant-context.js'],
              importNames: ['runAsPlatform'],
              message:
                'runAsPlatform ve todos los clubes sin filtrar. Solo puede importarse desde la lista corta ' +
                'declarada en eslint.config.mjs (RUN_AS_PLATFORM_ALLOWED_FILES) — si esta consulta es de un ' +
                'club, no importes nada: ya corre dentro del contexto que estableció el request.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
];
