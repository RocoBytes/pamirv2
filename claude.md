# CONTEXTO PRINCIPAL Y DIRECTRICES DE ARQUITECTURA
Eres el Tech Lead de un proyecto web Full-Stack (PERN: PostgreSQL, Express/NestJS, React, Node.js). Tu objetivo es construir un sistema de registro de salidas de montaña. 

Dispones de un set de subagentes especializados (awesome-claude-code-subagents, Base Everything, 0xfurai para código/técnica, cc-them para estrategia). Debes orquestar este desarrollo utilizando la metodología "Team Agent", delegando mentalmente o mediante tus herramientas las tareas según corresponda.

# RESTRICCIONES CRÍTICAS (APLICAR ESTRICTAMENTE)
1. INFRAESTRUCTURA AUTOALOJADA: El despliegue es Docker Compose en un VPS Contabo detrás de Cloudflare (dominio `andinoclubpamir.app`, proxy naranja, TLS Full (strict) con certificado de origen). La base de datos vive en Neon.tech (NUNCA se dockeriza ni se migra) y el storage es Google Drive API.
2. DOCKER ES LA VÍA DE DESPLIEGUE: `backend/Dockerfile`, `frontend/Dockerfile` y `deploy/docker-compose.yml` son canónicos. El nginx del contenedor frontend sirve el SPA y proxea `/api` al backend (same-origin). El CI/CD es GitHub Actions → GHCR → deploy por SSH al VPS (`.github/workflows/deploy.yml`). El desarrollo local sigue siendo Node nativo (`npm run dev` en cada carpeta).
3. CRON: el ping anti-cold-start de 14 minutos quedó OBSOLETO (el VPS no duerme). `GET /api/cron/check-alertas` corre desde el crontab del VPS (`/opt/pamir/bin/check-alertas.sh` bajo flock), nunca desde un proveedor externo a la vez que el crontab.
4. GESTIÓN DE MEMORIA: Para subir archivos .gpx (hasta 15MB) a Google Drive se usa un flujo de Streams (Resumable Upload) en Node.js, nunca cargando el buffer completo en memoria RAM. nginx debe mantener `proxy_request_buffering off` en `/api/` para preservarlo.
5. UNA SOLA RÉPLICA DE BACKEND: el rate limiting es en memoria; jamás escalar el servicio backend a más de un contenedor.

# PLAN DE EJECUCIÓN POR FASES (ESPERA CONFIRMACIÓN ENTRE FASES)
Ejecutaremos el proyecto fase por fase. Al terminar una fase, harás un reporte técnico, correrás linters/compilación para verificar que no hay errores, y te detendrás a esperar mi comando "Avanzar a la siguiente fase".

Entendido esto, invoca tu lógica de estrategia (cc-them) para revisar este plan y comienza ejecutando EXCLUSIVAMENTE la FASE 1.

# Contexto del Proyecto y Metodología Team Agent
Actúa como un "Agente Orquestador" (Tech Lead) para liderar el desarrollo de una aplicación web completa. Utilizaremos la metodología "Team Agent", por lo que deberás subdividir tus tareas asumiendo los roles de "Arquitecto Backend", "Especialista Frontend" y "DevOps" en distintas fases.

Al finalizar cada fase, detente, hazme un resumen de lo implementado, confirma que las pruebas pasaron y pídeme autorización para iniciar la siguiente fase.

# Stack Tecnológico y Restricciones
- Stack: PERN (PostgreSQL, Express/NestJS, React, Node.js) con TypeScript estricto.
- Frontend: React + Vite + Tailwind CSS.
- Backend: Node.js (Express o NestJS, a tu criterio para mejor mantenibilidad).
- Base de datos: PostgreSQL (alojada en Neon.tech; externa al VPS, nunca dockerizada).
- Infraestructura: Docker Compose en VPS Contabo (nginx + backend) detrás de Cloudflare; dominio `andinoclubpamir.app`.
- Almacenamiento: API de Google Drive.
- Despliegue: imágenes en GHCR construidas por GitHub Actions; `deploy/docker-compose.yml` corre en `/opt/pamir` del VPS. Rollback por tag de SHA.
- Estructura: monorepo simple basado en carpetas (`/frontend` y `/backend` en la raíz) sin herramientas complejas como Turborepo, manteniendo los `package.json` independientes.

# Plan de Ejecución por Fases

## Fase 1: Andamiaje y Configuración Inicial (Rol: DevOps / Tech Lead)
1. Inicializa el repositorio.
2. Crea los directorios `/frontend` y `/backend`.
3. Inicializa React+Vite+TypeScript en el frontend y Node+TypeScript en el backend.
4. Configura ESLint y Prettier en ambos.
5. Crea un archivo `README.md` detallando los comandos de inicio de desarrollo para cada carpeta.
6. En el `/backend`, asegúrate de que el `package.json` tenga los scripts `"build"` (tsc) y `"start"` (node dist/index.js) necesarios para Render.com.

## Fase 2: Backend Core y Base de Datos (Rol: Arquitecto Backend)
1. Instala y configura Prisma ORM o TypeORM para conectar con PostgreSQL (URL provista por entorno).
2. Crea el esquema de base de datos para manejar `Users` y `Salidas` (Fichas de registro de alpinismo).
3. Implementa un endpoint `GET /api/health` que responda `200 OK` instantáneamente. (Crítico: este endpoint recibirá pings cada 14 minutos desde un cronjob externo para evitar el cold start de Render).
4. Prepara la estructura de rutas/controladores para el CRUD del formulario de salidas.

## Fase 3: Integraciones y Lógica Compleja (Rol: Arquitecto Backend)
1. Integra el SDK de Google Auth (Identity Services) para verificar tokens JWT en el backend.
2. Integra la API oficial de Google Drive (`googleapis`).
3. Crea un endpoint especializado para la carga de archivos (rutas `.gpx` de hasta 15MB). El endpoint debe procesar el archivo usando **Streams** y el método **Resumable Upload** de Google Drive para evitar sobrecargar la memoria RAM de la capa gratuita de Render.

## Fase 4: Frontend y UI/UX (Rol: Especialista Frontend)
1. Configura Tailwind CSS y Lucide React.
2. Construye una UI "mobile-first", moderna y accesible.
3. Implementa un formulario tipo "Wizard" (Multi-paso de 5 secciones) para el registro de salidas de montaña.
4. Usa `React Hook Form` y `Zod` para la gestión de estado local y validación estricta antes del envío.
5. Implementa la persistencia en `localStorage` (caché local) para que el alpinista no pierda sus datos si recarga el navegador accidentalmente en la montaña.
6. Crea el flujo de inicio de sesión con Google Auth y una opción para continuar como "Invitado".

## Fase 5: Preparación para Despliegue (Rol: DevOps)
1. Revisa que todas las variables de entorno (`.env.example`) estén documentadas.
2. Verifica que el frontend tenga configurado correctamente su proxy o variables de entorno para apuntar al backend de producción vs desarrollo.
3. Asegura que el comando `npm run build` en el frontend genere correctamente la carpeta `/dist` para Vercel.

Entendido esto, asume el rol de Arquitecto/Tech Lead y comienza ejecutando exclusivamente la FASE 1. No avances a la Fase 2 sin mi confirmación. Imprime los comandos que vas a ejecutar o crea los archivos correspondientes.
