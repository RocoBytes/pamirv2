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
npm run db:create-user -- --email alguien@club.cl --name "Nombre Apellido" --rol ADMIN --org pamir
```

`--rol` acepta `SOCIO`, `LIDER` o `ADMIN` (por defecto `SOCIO`). `--org <slug>`
es **requerido** (ya no tiene un valor por defecto, ahora que hay más de un
club): ejecuta `npm run tenant:list` para ver los slugs existentes. Pide la
contraseña por stdin (nunca por flag) y la confirma dos veces si hay una TTY.
Usa `--force` para actualizar un usuario existente en vez de fallar (nunca
cambia de club a un usuario existente).

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
- **Wizard de registro y membresía asignada por el servidor** (`POST
  /api/integrantes`): el formulario `RegistroIntegrante` (un wizard de 4
  pasos — ver "Frontend: branding y sesión por club" abajo) ya no pregunta a
  qué club dice pertenecer quien se registra; el servidor asigna siempre
  `membresiaClub = req.user.organization.membresiaPropia` y `nombreClub:
  null`, e ignora cualquier valor que el body traiga para esos dos campos —
  incluido un frontend cacheado viejo o un cliente que intente enviar la
  membresía de otro club (`backend/src/lib/integrante-membresia.ts`,
  `membresiaParaNuevaFicha`). Toda ficha nueva es socia del club donde se
  crea, sin excepción.
- **Fichas de salud entre clubes**: comportamiento deliberado, no un bug. Tras
  el aislamiento, un participante cuya ficha de `Integrante` vive en OTRO club
  simplemente no existe acá: el resumen de salud de una salida y el correo
  que lo acompaña marcan `fichaEncontrada: false` con el texto "sin ficha en
  este club", y el buscador de participantes por RUT del wizard ofrece
  agregarlo como participante express o pedirle que complete su propia ficha
  en ese club. Los datos médicos nunca se comparten entre clubes.

### Frontend: branding y sesión por club

El frontend nunca hardcodea el nombre o el logo de un club. `login`/`GET
/api/me` devuelven `user.organization` (`id`, `slug`, `name`, `shortName`,
`membresiaPropia`); `App.tsx` lo pasa a `OrganizationProvider`
(`frontend/src/contexts/OrganizationContext.tsx`), y cualquier componente lo
lee con el hook `useOrganization()` (`frontend/src/hooks/useOrganization.ts`),
que además expone valores ya listos para pintar (`displayName`, `shortName`,
`memberBadge`, `logoSrc`) calculados por los helpers puros de
`frontend/src/lib/club-brand.ts`.

- **Logos**: cada club sirve el suyo en `frontend/public/logos/<slug>.png` —
  agregar uno nuevo es subir ese único archivo, sin tocar código.
  `frontend/public/logos/_default.svg` es el logo neutral: se usa mientras no
  se conoce el club (pre-login) y cae ahí automáticamente si el PNG del club
  no existe (`ClubLogo`, componente en `frontend/src/components/ClubLogo.tsx`,
  cambia el `src` una sola vez ante un error de carga — nunca queda pegado en
  un bucle ni muestra el logo de otro club).
- **Pantallas sin sesión**: el login es neutral por diseño (nunca se sabe a
  qué club pertenece quien mira la pantalla antes de autenticar). Aceptar una
  invitación y la evaluación express sí muestran marca — la del club que la
  API resuelve para ESE token (`organization` en la respuesta de `POST
  /api/auth/invitaciones/consultar` y de `GET /api/evaluaciones/:token`), no
  la de la sesión.
- **Borradores por usuario, no por navegador**: `frontend/src/lib/storage.ts`
  guarda `pamir_owner` (el id del último usuario autenticado en ese
  navegador) y lo compara en cada inicio de sesión (`establishSession`,
  llamada desde `login`, el refresco de `/me` al montar la app, y el login
  automático tras aceptar una invitación). Mismo usuario → conserva el
  borrador de salida (`pamir_draft`) y la caché de integrantes
  (`pamir_integrantes`); usuario distinto → los purga antes de escribir la
  sesión nueva. Cerrar sesión NO purga nada a propósito: recargar en la
  montaña sin señal no debe perder la ficha en curso.
- **`RegistroIntegrante` ya no pregunta a qué club pertenece la persona**: la
  ficha pertenece al club donde se crea, así que el servidor asigna siempre su
  `membresiaPropia` (`nombreClub: null`) — ver "Wizard de registro y membresía
  asignada por el servidor" más abajo. **La lista de membresía de
  `Step3Equipment` sigue siendo dato cruzado entre clubes**: sus opciones
  (`Socio Andino Club Pamir`, `Socio Club El Montañista`, …) describen a QUÉ
  CLUB dice pertenecer un PARTICIPANTE de una salida (un socio de un club
  puede participar en la salida de otro) — eso no es branding del tenant y no
  se toca.

### Alta y administración de clubes (CLI `tenant`)

Dar de alta un club nuevo es más que una fila de `Organization`: sin
categorías no se puede publicar ningún evento, y sin una declaración jurada
vigente toda inscripción responde 422. El CLI `backend/src/scripts/tenant.ts`
(`services/tenants.service.ts` + `lib/tenant-defaults.ts`) crea todo eso en
una sola transacción e invita a su primer `ADMIN`, desde `backend/`:

```bash
# Alta de un club nuevo (categorías + declaración jurada + invitación del ADMIN)
npm run tenant:create -- \
  --slug el-montanista \
  --name "Club El Montañista" \
  --membresia SOCIO_EL_MONTANISTA \
  --alert-email alertas@elmontanista.cl \
  --contact-name "Nombre del contacto" \
  --contact-email contacto@elmontanista.cl \
  --admin-email admin@elmontanista.cl

# Listar todos los clubes (slug, nombre, estado, membresía, usuarios, invitaciones pendientes)
npm run tenant:list

# Suspender / reactivar un club
npm run tenant:suspend -- --slug el-montanista
npm run tenant:activate -- --slug el-montanista

# Reemitir el link del primer ADMIN (la invitación anterior expiró o el email era incorrecto)
npm run tenant:invite -- --slug el-montanista --admin-email otro-admin@elmontanista.cl

# Corregir uno o más datos de un club ya existente
npm run tenant:update -- --slug el-montanista \
  --name "Club El Montañista" \
  --contact-name "Nombre del contacto" \
  --contact-email contacto@elmontanista.cl
```

`tenant:update` corrige `--name`, `--short-name`, `--contact-name`, `--contact-email` y
`--alert-email` de un club existente (al menos uno de los cinco, los demás quedan
sin tocar). **`--slug`, `--membresia` y el estado (`suspend`/`activate`) NO son
editables ahí**: el slug rompería URLs y la lista de slugs reservados, la
membresía es la clave del puente entre clubes, y el estado ya tiene su propio
flujo. `--short-name ""` limpia el nombre corto vigente. El comando solo
imprime lo que realmente cambió (un valor idéntico al vigente no cuenta como
cambio) y, si `--alert-email` cambió, advierte que ese correo es el destino de
la alerta de seguridad "salida sin cierre" y que no tiene paso de
verificación.

`tenant:create` crea, en una sola transacción: la `Organization`, sus 6
categorías de evento por defecto (las mismas que tiene Pamir hoy) y su
declaración jurada vigente (mismo texto que la de Pamir, que no nombra a
ningún club). Recién después de confirmar esa transacción emite la
invitación del primer `ADMIN` con `crearInvitacionPlataforma` (ver más
arriba); si el envío del correo o la emisión del link fallaran, **el club
queda creado igual** — la salida del comando lo dice explícitamente y da el
comando de `tenant:invite` para reintentar solo la invitación, en vez de
dejar al operador adivinando o de revertir un club ya comprometido.

El link de invitación es de **un solo uso y expira en 7 días**, igual que
cualquier otra invitación (ver "Roles e invitaciones" más arriba); pasado ese
plazo, o si el correo era incorrecto, `tenant:invite` reemite uno nuevo y
revoca automáticamente cualquier invitación pendiente anterior para ese
mismo correo.

**Regla de membresía y límite del puente (bridge)**: `--membresia` debe ser
uno de los códigos declarados en `backend/src/lib/membresias.ts`
(`MEMBRESIAS_PROPIAS`) — hoy, exactamente dos: `SOCIO_ANDINO_PAMIR` y
`SOCIO_EL_MONTANISTA`, uno por club real. La base de datos no impone que sea
único (`Organization.membresiaPropia` no tiene una restricción `UNIQUE`), así
que `tenant:create` lo comprueba a mano y rechaza un código ya usado por otro
club: dos clubes con la misma membresía propia leerían la biblioteca de
documentos del otro (ver `lib/documentos-access.ts` más arriba). Dar de alta
un **tercer club** requiere agregar su código en `MEMBRESIAS_PROPIAS` (además
de las etiquetas `CLUB_BADGE_LABELS`/`CLUB_FILTER_LABELS` en
`frontend/src/types/salida.ts`, que usan las insignias y el filtro "Club" de
administración) antes de poder crearlo — el formulario de registro
(`RegistroIntegrante`) ya no lista clubes, así que no hay que tocarlo.

**Slugs reservados** (rechazados por `tenant:create`/`suspend`/`activate`/
`invite`, no por el servicio en sí): cualquiera que empiece con `iso-test-`
(los crea y purga `npm run test:isolation`), y además `platform`,
`plataforma`, `admin`, `api`, `www`, `app`, `riala`.

**Suspender un club** (`tenant:suspend`) bloquea el login y **toda** request
autenticada de ese club con `403` (ver `middleware/auth.middleware.ts` /
`controllers/auth.controller.ts`), pero las alertas de seguridad de "salida
sin cierre" de sus salidas ya abiertas **siguen enviándose** — la suspensión
no es una desconexión de emergencia de la seguridad de montaña.
`tenant:activate` revierte todo lo anterior.

**Producción (VPS)**: el contenedor `backend` de `deploy/docker-compose.yml`
no tiene `backend/db-target.json` ni `tsx` — ahí un script solo corre
compilado, con `ALLOW_ANY_DB_TARGET=1` (ver `backend/.env.example`) para
saltarse una guardia pensada para el entorno local:

```bash
cd /opt/pamir
docker compose exec -e ALLOW_ANY_DB_TARGET=1 backend node dist/scripts/tenant.js list
docker compose exec -e ALLOW_ANY_DB_TARGET=1 backend node dist/scripts/create-user.js --email ... --name "..." --rol ADMIN --org el-montanista
```

`FRONTEND_URL` ahí debe ser la URL pública del frontend (la misma SPA sirve a
todos los clubes, same-origin — nunca `localhost`): el CLI imprime una
advertencia explícita si la detecta, precisamente para que nunca se le mande
un enlace de invitación con `localhost` a un administrador real.

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
(ahí llegan los rebotes). El dominio `riala.cl` debe tener SPF, DKIM y DMARC
configurados — sin eso el correo cae en spam o se rechaza directamente.

**Una cuenta SMTP por dirección remitente**: el servidor de correo real (mailcow
de por medio) impone "sender ownership" — rechaza en RCPT TO cualquier envío
autenticado con una cuenta que no es dueña de la dirección remitente usada, en
vez de dejar que cualquier cuenta envíe como cualquier dirección. Un intento
real de enviar una `alerta` autenticado como `notificaciones@riala.cl` lo
confirmó con este rechazo:

```
553 5.7.1 <alertas@riala.cl>: Sender address rejected: not owned by user notificaciones@riala.cl
```

Por eso `notificaciones@riala.cl` y `alertas@riala.cl` se autentican cada una
con SU PROPIA cuenta (`SMTP_USER_NOTIFICACIONES`/`SMTP_PASS_NOTIFICACIONES` y
`SMTP_USER_ALERTAS`/`SMTP_PASS_ALERTAS` en `backend/.env.example`) en vez de
compartir la cuenta global `SMTP_USER`/`SMTP_PASS`. Un tipo sin su propio par
cae al par global — útil mientras solo hay una cuenta real, pero en producción
las alertas son correo de SEGURIDAD ("salida sin cierre"), así que un rechazo
permanente por sender ownership es el peor modo de falla posible: mejor
configurar el par propio de cada tipo desde el día uno. Ambas variables de un
mismo par deben definirse juntas — definir solo una mitad detiene el arranque
del proceso nombrando la que falta (ver `resolveMailAccounts` en
`backend/src/lib/config.ts`). Dos tipos que terminan resolviendo la misma
cuenta (mismo host+puerto+usuario) comparten una sola conexión SMTP en vez de
abrir un pool por tipo.

El envío real pasa por un puerto (`EmailProvider`,
`backend/src/lib/email/email-provider.ts`) con dos adaptadores:

- **`smtp`**: producción. Envía por el servidor de correo propio (autenticado,
  nunca un proveedor externo) usando el puerto 587 con STARTTLS obligatorio o
  el 465 con TLS implícito. Requiere `SMTP_HOST`, `SMTP_PORT` y, para cada tipo
  de correo, una cuenta resuelta (propia o global — ver arriba).
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

**Verificación manual**: `npm run test:email -- <destino@ejemplo.com>` (desde
`backend/`) envía un correo real por cada tipo (`notificacion` y `alerta`)
usando la configuración real del entorno, e imprime un `✓`/`✗` por tipo con el
remitente usado — es el chequeo repetible de "cada dirección puede realmente
enviar como sí misma". Se niega a correr si algún tipo resolvería al
adaptador `console` en vez de `smtp`. Nunca imprime contraseñas ni el cuerpo
del correo.

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
dirección, su propio par de credenciales (`userEnvVar`/`passEnvVar`) y su
valor por defecto. Ningún llamador ni `club-email.ts` cambian.

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

**Excepción — logo del club** (`orgs/{organizationId}/logo/{uuid}.{png|jpg}`):
es marca pública, no un documento privado, y tiene que renderizarse en un
`<img>` en pantallas sin sesión (login previo a autenticar), donde una URL
firmada de 10 minutos no sirve (expira, arrastra `Content-Disposition:
attachment` y exige una ronda de red autenticada antes de pintar). Por eso se
sirve **por bytes desde el backend** en vez de con una URL firmada:

- `GET /api/clubes/:slug/marca` — público, `{ slug, name, shortName, hasLogo,
  logoVersion }`.
- `GET /api/clubes/:slug/logo` — público, los bytes del logo con `ETag` y
  `Cache-Control` (`public, max-age=31536000, immutable` con `?v=<logoVersion>`;
  `public, max-age=300` sin ese parámetro, honrando `If-None-Match`).

La mitad importante de la regla general se mantiene intacta: en la base
**nunca** se guarda ni se devuelve una URL, solo la clave del objeto
(`Organization.logoObjectKey`). Ninguna otra ruta de `/api` declara
`Cache-Control: public` — no crear una regla de Cloudflare que cachee todo
`/api/` a partir de esta excepción.

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

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) define el pipeline. Ningún
push a `main` despliega por sí solo: publica imágenes nuevas, pero el despliegue queda
en espera hasta que una persona lo aprueba.

1. **Cada push y cada pull request** corren los jobs `verify-backend` y
   `verify-frontend` (lint, tests y build de ambos paquetes).
2. **Solo los push a `main`** además construyen y publican
   `ghcr.io/rocobytes/pamir-backend` y `ghcr.io/rocobytes/pamir-frontend` en GHCR,
   con los tags `latest` y `sha-<commit>`. Los pull requests nunca publican; un
   `workflow_dispatch` manual solo publica si se ejecuta sobre `main`.
3. El job de despliegue espera entonces la aprobación del entorno `production` de
   GitHub y no toca el VPS hasta que un revisor la concede. Con esa aprobación:
   - escribe el `PAMIR_TAG` de esta imagen en `/opt/pamir/.env`,
   - hace `docker compose pull` de las imágenes nuevas,
   - imprime las migraciones pendientes (`prisma migrate status`),
   - las aplica,
   - levanta los contenedores (`docker compose up -d --remove-orphans`),
   - y verifica `/api/health` antes de darse por terminado.

La aprobación se dispara antes de que el job arranque, así que quien aprueba **no** ve
todavía ese listado de `prisma migrate status`: se imprime recién después, dentro del
job. Para aprobar con conocimiento real de qué migraciones se van a aplicar, antes de
aprobar hay que conectarse por SSH al VPS y correr:

```bash
cd /opt/pamir && docker compose run --rm migrate npx prisma migrate status
```

El frontend se construye **sin** `VITE_API_URL`: el SPA usa `/api` relativo
(same-origin).

Configuración que el pipeline no puede crear por sí mismo:

- Secrets del entorno `production`: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`.
- Un entorno `production` en GitHub con un revisor obligatorio.
- `/opt/pamir/.env` debe existir de antemano con los secrets reales; el paso de
  despliegue se niega a continuar si no lo encuentra, para no arriesgarse a
  sobrescribirlo.

**Rollback**: por SSH al VPS, fija `PAMIR_TAG` en `/opt/pamir/.env` a un tag
`sha-` anterior y corre `docker compose up -d`.

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
