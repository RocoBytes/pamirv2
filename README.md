# Pamir

Sistema de registro de salidas de montaña — stack PERN.

**Frontend**: React 19 + Vite 8 + TypeScript + Tailwind CSS (Fase 4)
**Backend**: Express 4 + TypeScript
**Base de datos**: PostgreSQL en Neon.tech (Fase 2)
**Despliegue**: Docker Compose en VPS (Contabo) detrás de Cloudflare — `https://andinoclubpamir.app`

---

## Requisitos

- Node.js 18+
- npm 10+

---

## Desarrollo

### Frontend

```bash
cd frontend
npm install
npm run dev        # servidor Vite en http://localhost:5173
npm run build      # type-check + build → frontend/dist/
npm run lint       # ESLint + Prettier rules
npm run preview    # previsualizar build de producción
```

### Backend

```bash
cd backend
npm install
npm run dev        # ts-node-dev con hot reload en http://localhost:3001
npm run build      # tsc → compila a backend/dist/
npm run start      # node dist/index.js  (comando de producción en Render.com)
npm run lint       # ESLint
npm run format     # Prettier
```

### Ambos workspaces desde la raíz

```bash
# Instalar todas las dependencias
(cd frontend && npm install) && (cd backend && npm install)

# Lint ambos
(cd frontend && npm run lint) && (cd backend && npm run lint)

# Build ambos
(cd frontend && npm run build) && (cd backend && npm run build)
```

---

## Variables de entorno

```bash
cp backend/.env.example backend/.env    # Fase 2: DATABASE_URL, GOOGLE_CLIENT_ID, etc.
cp frontend/.env.example frontend/.env  # Fase 2: VITE_API_URL, etc.
```

---

## Protección de la base de datos y gestión de usuarios (v2)

`backend/db-target.json` declara un fragmento del host de Neon (`allowedHostFragment`)
que `DATABASE_URL` debe contener. Los comandos `db:push`, `db:deploy`, `db:migrate`,
`db:studio` y `db:create-user` corren primero `npm run db:guard`, que aborta si
`DATABASE_URL` no coincide — evitando que un comando local termine tocando la
base de v1. Con el archivo vacío (como viene por defecto) el guard siempre falla;
complétalo con el fragmento del proyecto Neon de v2 antes de usar esos comandos.

El sistema es de acceso cerrado: no existe registro público. La UI no ofrece
un formulario de creación de cuenta y `POST /api/auth/register` ya no existe
en la API (responde 404). Las cuentas se crean solo por invitación (ver más
abajo) o con el CLI interactivo:

```bash
cd backend
npm run db:create-user -- --email alguien@club.cl --name "Nombre Apellido" --rol ADMIN
```

`--rol` acepta `SOCIO`, `LIDER` o `ADMIN` (por defecto `SOCIO`). Pide la
contraseña por stdin (nunca por flag) y la confirma dos veces si hay una TTY.
Usa `--force` para actualizar un usuario existente en vez de fallar.

Un usuario existente sin contraseña (por ejemplo, migrado desde Clerk) ingresa
por primera vez usando "¿Olvidaste tu contraseña?": el enlace de
restablecimiento define su contraseña y verifica su email en el mismo paso.

El acceso de administrador depende únicamente del rol (`ADMIN`) guardado en la
base de datos, nunca de un email fijo: el comando anterior con `--rol ADMIN`
(o con `--force` sobre un usuario existente) es la forma de otorgarlo o
revocarlo, sin redeploy. La variable `ALERT_EMAIL` (ver `backend/.env.example`)
es un asunto distinto: solo define a quién llegan las alertas automáticas de
"salida sin cierre".

Ningún endpoint que lea o escriba datos admite llamadas anónimas: todos exigen
`requireAuth` (sesión válida). Los únicos endpoints públicos son
`GET /api/health` (liveness, no toca la base de datos), los de
`/api/auth` (login, verificación de email, recuperación de contraseña y los
dos de invitación descritos abajo — son el mecanismo para obtener una sesión
o crear la cuenta), `GET`/`POST /api/evaluaciones/:token` (formulario anónimo
protegido por un token de un solo uso) y `GET /api/cron/check-alertas`
(protegido por `CRON_SECRET`, no por sesión). Una prueba automatizada
(`backend/src/routes/public-routes.test.ts`) fija esta lista: agregar una ruta
anónima nueva sin actualizarla hace fallar la suite.

### Roles e invitaciones

Tres roles (`RolUsuario`): `SOCIO` (rol base), `LIDER` (un socio al que además
se le permite invitar nuevos socios; no otorga ningún otro permiso en el
resto de la aplicación) y `ADMIN` (control total, incluida la gestión de
usuarios y roles). Un `ADMIN` puede invitar cualquier rol; un `LIDER` solo
puede invitar `SOCIO`. Nadie puede cambiar su propio rol, lo que garantiza que
el sistema siempre conserve al menos un `ADMIN`.

Ciclo de vida de una invitación:

- Vigencia de **7 días** desde su creación; se puede **reenviar** (invalida el
  token anterior y emite uno nuevo) o **revocar** mientras esté pendiente.
- Es de **un solo uso**: al aceptarse queda marcada como `ACEPTADA` y no puede
  reutilizarse ni reenviarse.
- Solo se persiste el **hash SHA-256** del token, nunca el valor en claro; el
  enlace enviado por correo usa el token como **fragmento de URL**
  (`/#invite=...`), que nunca llega al servidor ni a los logs del proxy.
- Un `LIDER` solo ve y administra sus propias invitaciones; un `ADMIN` ve
  todas.

Endpoints (bajo `/api/invitaciones`, requieren sesión con rol `ADMIN` o
`LIDER`, salvo los dos públicos indicados):

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/invitaciones` | Crea una invitación y envía el correo |
| `GET` | `/api/invitaciones` | Lista invitaciones (propias o todas si es `ADMIN`) |
| `POST` | `/api/invitaciones/:id/revocar` | Revoca una invitación pendiente |
| `POST` | `/api/invitaciones/:id/reenviar` | Reenvía (token nuevo) una invitación pendiente o expirada |
| `POST` | `/api/auth/invitaciones/consultar` *(público)* | Consulta los datos de una invitación por token (en el body) |
| `POST` | `/api/auth/invitaciones/aceptar` *(público)* | Acepta una invitación y crea la cuenta |

Gestión de usuarios (solo `ADMIN`, bajo `/api/admin`):

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/admin/users` | Lista todos los usuarios |
| `PATCH` | `/api/admin/users/:id/rol` | Cambia el rol de otro usuario |

---

## Clubes (multi-tenant)

La app nació para un solo club (Andino Club Pamir) y está migrando a servir
varios. Cada tabla de negocio lleva una columna `organization_id` (modelo
`Organization` en `backend/prisma/schema.prisma`, tabla `organizations`), y
una prueba estática (`backend/src/lib/schema-organization.test.ts`) falla si
se agrega un modelo nuevo sin ella. Una cuenta (`User.email`) pertenece a
exactamente un club — no hay cuentas compartidas entre clubes. `numeroSalida`
es un correlativo por club (no una secuencia global de Postgres): se asigna
dentro de una transacción que incrementa `organizations.ultimo_numero_salida`.
El CLI `db:create-user` acepta `--org <slug>` (por defecto `pamir`) para
elegir el club del usuario a crear.

Esta fase solo agrega el modelo de datos y hace viajar `organizationId` en
cada escritura. El aislamiento real entre clubes (derivar la organización
vigente de la sesión o, en flujos públicos por token, de la fila padre, y
filtrar cada lectura) llega en la fase siguiente.

---

## Despliegue

Arquitectura: un stack de Docker Compose en el VPS. El contenedor `nginx`
(imagen del frontend) termina TLS con el certificado de origen de Cloudflare,
sirve el SPA y proxea `/api` al contenedor `backend` (same-origin, sin CORS).
La base de datos permanece en Neon.tech; los archivos van a Google Drive.
Los contenedores son 100% stateless.

### CI/CD (GitHub Actions)

Cada push a `main` dispara [.github/workflows/deploy.yml](.github/workflows/deploy.yml):

1. Construye `ghcr.io/rocobytes/pamir-backend` y `ghcr.io/rocobytes/pamir-frontend`
   (tags `latest` + SHA del commit) y las publica en GHCR.
2. Por SSH copia [deploy/docker-compose.yml](deploy/docker-compose.yml) a
   `/opt/pamir/` y ejecuta:
   ```bash
   docker compose pull
   docker compose run --rm migrate   # prisma migrate deploy contra Neon
   docker compose up -d --remove-orphans
   ```

Secrets requeridos en GitHub: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
`VPS_KNOWN_HOSTS`. El frontend se construye **sin** `VITE_API_URL`: el SPA usa
`/api` relativo (same-origin).

**Rollback**: fija el tag del SHA anterior en `/opt/pamir/docker-compose.yml`
y `docker compose up -d`.

### Layout en el VPS

```
/opt/pamir/
├── docker-compose.yml      # sincronizado por el workflow en cada deploy
├── .env                    # secrets de producción (chmod 600, nunca en git)
├── certs/
│   ├── origin.pem          # certificado de origen de Cloudflare
│   └── origin.key
└── bin/
    └── check-alertas.sh    # cron de alarmas (bajo flock, cada 10 min)
```

El backend publica su puerto solo en `127.0.0.1:3001` (para el crontab);
públicamente solo se exponen 80/443 vía nginx.

### Cron de alarmas

`GET /api/cron/check-alertas` corre desde el crontab del VPS (no desde un
proveedor externo). El ping anti-cold-start de la era Render quedó obsoleto:

```cron
*/10 * * * * flock -n /opt/pamir/check-alertas.lock /opt/pamir/bin/check-alertas.sh >> /opt/pamir/cron.log 2>&1
```

### Neon.tech (Base de datos)

Sin cambios: `DATABASE_URL` (pooled) en `/opt/pamir/.env`. Las migraciones las
aplica el servicio `migrate` del compose en cada deploy.

---

## Estado del proyecto

| Fase | Descripción | Estado |
|---|---|---|
| 1 | Andamiaje y configuración inicial | ✅ Completa |
| 2 | Backend core y base de datos | ✅ Completa |
| 3 | Integraciones (Google Auth + Drive) | ✅ Completa |
| 4 | Frontend UI/UX (Wizard 5 pasos) | ✅ Completa |
| 5 | Preparación para despliegue | ✅ Completa |
