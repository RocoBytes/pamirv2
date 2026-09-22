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
cp backend/.env.example backend/.env    # Fase 2: DATABASE_URL, JWT_SECRET, etc.
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
revocarlo, sin redeploy. A quién llegan las alertas automáticas de "salida sin
cierre" es un asunto distinto (ver la sección "Clubes (multi-tenant)" más
abajo): depende del club, no de una variable de entorno fija.

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

La app nació para un solo club (Andino Club Pamir) y sirve varios. Cada tabla
de negocio lleva una columna `organization_id` (modelo `Organization` en
`backend/prisma/schema.prisma`, tabla `organizations`), y una prueba estática
(`backend/src/lib/schema-organization.test.ts`) falla si se agrega un modelo
nuevo sin ella. Una cuenta (`User.email`) pertenece a exactamente un club — no
hay cuentas compartidas entre clubes. `numeroSalida` es un correlativo por
club (no una secuencia global de Postgres): se asigna dentro de una
transacción que incrementa `organizations.ultimo_numero_salida`. El CLI
`db:create-user` acepta `--org <slug>` (por defecto `pamir`) para elegir el
club del usuario a crear.

Los clubes guardan datos MÉDICOS de sus socios, así que el aislamiento entre
ellos es estricto y **falla cerrado**: cualquier consulta que no declare
explícitamente su alcance se rechaza, en vez de arriesgarse a filtrar de más.

### Cómo se aplica

El aislamiento se enforza en un solo lugar, no en cada uno de los ~130 sitios
de llamada `prisma.<modelo>.<operacion>` repartidos por controllers/services/
scripts:

- `backend/src/lib/tenant-context.ts` guarda, con `AsyncLocalStorage`, el
  **contexto de tenant** vigente para la ejecución async actual (el request
  completo, incluidas sus consultas anidadas y transacciones).
- `backend/src/lib/scope-args.ts` es una función pura que, dado un modelo, una
  operación de Prisma y el contexto vigente, decide los argumentos reales a
  ejecutar — agrega `organizationId` al `where`/`data` que corresponda, o
  lanza `TenantContextError` si algo no calza.
- `backend/src/lib/prisma.ts` envuelve el cliente único de Prisma con
  `$extends({ query: { $allModels: { $allOperations(...) } } })`, que llama a
  `scopeArgs` antes de cada consulta. Aplica también dentro de
  `prisma.$transaction(...)` (interactiva o en arreglo), porque el cliente
  extendido se propaga a `tx`.

Tres estados de contexto, nunca "ninguno" en una consulta real:

1. **Contexto de club** (`runWithOrganization(organizationId, fn)`): toda
   consulta a un modelo de tenant queda filtrada por ese `organizationId`, y
   crear/mover una fila a otro club lanza.
2. **Contexto de plataforma** (`runAsPlatform(fn)`): ve todos los clubes sin
   filtrar. Reservado para los pocos flujos genuinamente cross-club: login,
   verificación de email, recuperación de contraseña, consultar/aceptar una
   invitación por token, resolver el token de una evaluación, el barrido del
   cron de alarmas y los scripts de administración. ESLint (`no-restricted-
   imports` en `eslint.config.mjs`) restringe el import de `runAsPlatform` a
   esa lista corta de archivos — cualquier otro import falla el lint. La
   lista se mantiene corta a propósito: cada archivo nuevo es una decisión
   explícita y revisada, no un permiso heredado.
3. **Sin contexto**: una consulta ejecutada fuera de ambos lanza siempre
   (`store === undefined` es un bug, no un caso a tolerar).

`Organization` es un caso aparte ("auto-alcanzado"): en contexto de club,
cualquier operación sobre ella queda fijada a su propia fila
(`where.id === organizationId`); `AppSecret` es el único modelo realmente
global (sin club) y pasa sin filtrar en cualquier contexto.

### Reglas que no se pueden saltar

- **Busboy** (subida de `.gpx`, pronóstico, documentos y adjuntos de
  itinerario): `AsyncLocalStorage` no propaga de forma confiable hacia los
  callbacks de eventos de busboy (problema conocido de Node/Express). Los
  cuatro sitios de subida capturan el contexto con `bindTenantContext(...)`
  **antes** de `req.pipe(busboy)` y envuelven con él cada listener que toca la
  base de datos. Esto es obligatorio, no defensivo.
- **SQL crudo** (`$queryRaw`/`$executeRaw`): es invisible para la extensión
  del cliente (no pasa por `$allOperations`), así que cada ocurrencia agrega
  el filtro `organization_id = ...` a mano. Una prueba estática
  (`backend/src/lib/raw-sql-guard.test.ts`) escanea el código fuente y falla
  si aparece una ocurrencia nueva sin ese filtro.

### Qué NO garantiza

El aislamiento filtra la consulta de nivel superior de cada operación; una
relación cargada con `include`/`select` anidado **no se vuelve a comprobar**.
La seguridad depende de que cada FK (`salidaId`, `eventoId`, `usuarioId`,
etc.) provenga siempre de una fila ya resuelta dentro del mismo contexto —
nunca de un id que llegue crudo del cliente sin pasar antes por una consulta
scopeada.

### Comportamiento por club

`authMiddleware` carga una vez por request un resumen del club del usuario
(`req.user.organization`: `slug`, `name`, `shortName`, `membresiaPropia`,
`alertEmail`, `contactName`, `contactEmail`) — los controladores lo leen de
ahí en vez de volver a consultar `Organization`.

- **Alarma de "salida sin cierre"**: va al `alertEmail` DEL CLUB DUEÑO de la
  salida, no a una casilla global. Para desarrollo, `DEV_ALERT_EMAIL_OVERRIDE`
  (ver `backend/.env.example`) redirige todas las alarmas del cron a una
  casilla de pruebas; en producción (`NODE_ENV=production`) se **ignora
  siempre**, a propósito — un valor olvidado en el entorno no debe desviar en
  silencio la alarma de seguridad de un club hacia una sola casilla. El
  helper puro que decide esto es `backend/src/lib/alert-recipient.ts`.
- **Invitaciones emitidas por la plataforma**: dar de alta el primer `ADMIN`
  de un club nuevo es un problema de arranque (todavía no hay nadie en ese
  club que pueda invitarlo). `crearInvitacionPlataforma`
  (`backend/src/services/invitaciones.service.ts`) crea una invitación sin
  invitador (`invitadoPorId: null`, `emitidaPorPlataforma: true`), exenta de
  la regla que exige que el invitador siga existiendo y pueda otorgar ese rol.
  `consultarInvitacion` muestra "el equipo de la plataforma" como invitador.
  No tiene endpoint HTTP propio — la llamará un CLI de administración en una
  fase posterior. El `ADMIN` de un club gestiona (lista/revoca/reenvía) estas
  invitaciones igual que cualquier otra; un reenvío produce una invitación
  normal, emitida por quien reenvía.
- **Biblioteca de documentos** (`GET /api/documentos`): visible para el admin
  y para los socios cuya `Integrante.membresiaClub` coincida con la
  `Organization.membresiaPropia` DE ESE CLUB — nunca un valor fijo
  (`backend/src/lib/documentos-access.ts`). Dos personas con la misma
  afiliación de socio pueden obtener resultados distintos si consultan desde
  clubes distintos.
- **Fichas de salud entre clubes**: comportamiento deliberado, no un bug. Tras
  el aislamiento, un participante cuya ficha de `Integrante` vive en OTRO club
  simplemente no existe acá: el resumen de salud de una salida y el correo
  que lo acompaña marcan `fichaEncontrada: false` con el texto "sin ficha en
  este club", y el buscador de participantes por RUT del wizard ofrece
  agregarlo como participante express o pedirle que complete su propia ficha
  en ese club. Los datos médicos nunca se comparten entre clubes.

### Correo por club

Cada club envía sus propios correos con su propio nombre visible, no un
remitente único de la plataforma: `backend/src/lib/email/club-email.ts` arma
el remitente como `"<Organization.name>" <dirección>` (el nombre se sanea
para que no pueda inyectar cabeceras) y usa `Organization.contactEmail` como
`Reply-To` (se omite si no es un email válido). `backend/src/lib/email-
templates.ts` recibe ese branding (`brandingFor(org)`) y lo aplica a todos los
correos (encabezado, pie de página, asuntos) — ningún texto queda fijo a
"Pamir".

La DIRECCIÓN remitente, en cambio, no depende del club: es una de dos
direcciones fijas según el tipo de correo (`kind`, obligatorio en cada llamada
a `sendClubEmail` — ver `EmailKind` en `backend/src/lib/config.ts`):

- **`notificaciones@riala.cl`**: todo lo rutinario — invitaciones, registro de
  salidas, cierres, eventos, recuperación de contraseña, confirmación de
  ficha, formularios de salud.
- **`alertas@riala.cl`**: solo seguridad — la escalación de "salida sin
  cierre" y el recordatorio de cierre, ambos enviados por el cron.

Ambas direcciones deben existir como casilla o alias en el servidor de correo
(ahí llegan los rebotes) y la cuenta SMTP debe estar autorizada a enviar como
cada una. El dominio `riala.cl` debe tener SPF, DKIM y DMARC configurados —
sin eso el correo cae en spam o se rechaza directamente.

El envío real pasa por un puerto (`EmailProvider`,
`backend/src/lib/email/email-provider.ts`) con dos adaptadores:

- **`smtp`**: producción. Envía por el servidor de correo propio (autenticado,
  nunca un proveedor externo) usando el puerto 587 con STARTTLS obligatorio o
  el 465 con TLS implícito. Requiere `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y
  `SMTP_PASS`.
- **`console`**: desarrollo/tests. Nunca abre una conexión de red; solo
  registra un resumen (remitente, destinatario, asunto — nunca el HTML) y
  devuelve un id sintético. **Nunca** está permitido con `NODE_ENV=production`
  (falla al arrancar): un servidor que solo loguea las alarmas de seguridad en
  vez de enviarlas es inaceptable.

`EMAIL_PROVIDER` en `backend/.env.example` elige el adaptador explícitamente;
si se omite, se usa `smtp` cuando hay `SMTP_HOST` y `console` en caso
contrario. `MAIL_FROM_NOTIFICACIONES` y `MAIL_FROM_ALERTAS` permiten
sobrescribir cada dirección remitente sin tocar código: un valor vacío o en
blanco cae al valor por defecto, y uno presente pero inválido detiene el
arranque del proceso.

Cada envío puede llevar un `idempotencyKey`, que el adaptador `smtp` reenvía
como cabecera `X-Entity-Ref-ID` — solo trazabilidad, ya que SMTP no garantiza
deduplicar el envío: la cola de notificaciones de eventos usa el id de la
propia fila, y el cron de alarmas usa `alerta:<salidaId>` /
`recordatorio-cierre:<salidaId>`.

**Regla del cron de alarmas**: `alertaEnviadaAt` y `recordatorioCierreEnviadoAt`
se marcan **después** de que el proveedor acepta el envío, nunca antes. Si el
envío falla, la columna queda sin marcar y la corrida siguiente reintenta — un
reintento del cron puede DUPLICAR una alarma, pero nunca la PIERDE.

**Agregar un tipo de correo nuevo** (p. ej. `invitacion`): una sola entrada en
`MAIL_SENDER_DEFS` (`backend/src/lib/config.ts`), con su propia variable de
entorno y su valor por defecto. Ningún llamador ni `club-email.ts` cambian.

### Archivos en Google Cloud Storage

GPX, pronósticos, documentos de la biblioteca e itinerarios adjuntos se suben
directo a un bucket privado por entorno — `pamirv2-files-dev` y
`pamirv2-files-prod`, ambos en `southamerica-west1`, con acceso uniforme a
nivel de bucket y prevención de acceso público forzada. Nunca son públicos.

Cada entorno tiene su propia cuenta de servicio
(`pamirv2-storage-dev@pamirv2.iam.gserviceaccount.com` y
`pamirv2-storage-prod@pamirv2.iam.gserviceaccount.com`) con el rol
`roles/storage.objectUser` otorgado **solo sobre su propio bucket**, nunca a
nivel de proyecto — así una llave de desarrollo en un laptop jamás puede leer
los archivos de producción.

Los objetos se guardan como `orgs/{organizationId}/{gpx|pronostico|documento|
itinerario}/{uuid}.{ext}`. La URL de un archivo nunca se guarda ni se
devuelve en ningún payload: la descarga pasa siempre por uno de estos tres
endpoints, que primero repiten el chequeo de permiso del recurso y recién
después firman una URL de descarga válida por 10 minutos:

- `GET /api/salidas/:id/archivos/:tipo/url` (`tipo` = `gpx` o `pronostico`)
- `GET /api/documentos/:id/url`
- `GET /api/eventos/:id/itinerario/url`

Los registros legado (subidos antes de esta migración) siguen respondiendo su
link antiguo de Drive con `expiresInSeconds: null`; los nuevos devuelven una
URL firmada de GCS con `expiresInSeconds: 600`. Ningún archivo se bufferiza
en RAM ni se escribe a disco: la subida es un stream de punta a punta
(busboy → guardia de tamaño → stream de escritura resumible a GCS), y al
reemplazar o borrar un archivo el objeto anterior se limpia como huérfano.

Variables de entorno (`backend/.env.example`):

- `STORAGE_PROVIDER`: `gcs` (producción) o `memory` (solo en memoria del
  proceso). `memory` nunca está permitido con `NODE_ENV=production` y pierde
  todos los archivos al reiniciar — con él las descargas no funcionan.
- `GCS_BUCKET`, `GCS_PROJECT_ID`: nombre del bucket y proyecto dueño.
- `GCS_CREDENTIALS_JSON`: la llave de la cuenta de servicio, codificada en
  base64 y guardada siempre fuera del repositorio (`base64 < llave.json | tr
  -d '\n'`).

**Verificación manual** (necesita el proveedor `gcs` y el bucket de
desarrollo configurados):

```bash
cd backend
npm run test:storage
```

**Aprovisionamiento** (siempre con `--project=pamirv2`; el proyecto necesita
una cuenta de facturación activa antes de poder crear buckets):

```bash
gcloud storage buckets create gs://pamirv2-files-dev --project=pamirv2 --location=southamerica-west1 --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://pamirv2-files-dev --member=serviceAccount:pamirv2-storage-dev@pamirv2.iam.gserviceaccount.com --role=roles/storage.objectUser
```

El par de producción es idéntico, cambiando `dev` por `prod` en el nombre del
bucket y de la cuenta de servicio.

### Verificarlo

```bash
cd backend
npm run test:isolation
```

Corre contra la base de datos real de desarrollo (protegida por `db:guard`,
igual que `db:push`/`db:migrate`), crea dos clubes efímeros con datos que
colisionan a propósito (mismo RUT, mismo slug de categoría, mismo número de
salida, misma afiliación de socio en clubes con `membresiaPropia` distinta),
verifica el aislamiento a nivel de base de datos y de HTTP —incluida la regla
de la biblioteca de documentos y el ciclo de vida de una invitación de
plataforma— y borra todo lo que creó al terminar (incluso si algo falla a
mitad de camino).

---

## Despliegue

Arquitectura: un stack de Docker Compose en el VPS. El contenedor `nginx`
(imagen del frontend) termina TLS con el certificado de origen de Cloudflare,
sirve el SPA y proxea `/api` al contenedor `backend` (same-origin, sin CORS).
La base de datos permanece en Neon.tech; los archivos van a un bucket privado
de Google Cloud Storage (ver "Archivos en Google Cloud Storage" más abajo).
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
| 3 | Integraciones (login por invitación + Google Cloud Storage) | ✅ Completa |
| 4 | Frontend UI/UX (Wizard 5 pasos) | ✅ Completa |
| 5 | Preparación para despliegue | ✅ Completa |
