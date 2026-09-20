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

Las cuentas se crean con el CLI interactivo `db:create-user`:

```bash
cd backend
npm run db:create-user -- --email alguien@club.cl --name "Nombre Apellido" --rol ADMIN
```

`--rol` acepta `SOCIO` o `ADMIN` (por defecto `SOCIO`). Pide la
contraseña por stdin (nunca por flag) y la confirma dos veces si hay una TTY.
Usa `--force` para actualizar un usuario existente en vez de fallar.

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
