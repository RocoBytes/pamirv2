# CI/CD Deployment Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the repository a GitHub Actions pipeline that verifies every push, publishes identifiable images to GHCR, and deploys to the VPS only after a human approves.

**Architecture:** One workflow file with three chained stages — verify, images, deploy — where the deploy stage is gated by a GitHub Environment with a required reviewer. Supporting changes make the deployment reproducible (image tags pinned by commit SHA) and stop the Pamir container from answering for domains that are not its own.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, Docker Compose v2, nginx 1.29, Node 24, Prisma.

**Spec:** `docs/superpowers/specs/2026-09-22-cicd-deploy-pipeline-design.md`

## Global Constraints

- Node version is **24**, matching `node:24-bookworm-slim` in both Dockerfiles.
- Pamir's domain is **`andinoclubpamir.app`**. It does not change.
- **Exactly one backend replica, ever.** Rate limiting is in-memory.
- No npm `db:*` script may run in CI. Every one carries a `pre*` hook calling `db:guard`.
- `prisma generate` must run before `npm run build` in the backend.
- The frontend image is built **without** `VITE_API_URL`.
- Commit messages follow Conventional Commits. No `Co-Authored-By` trailers.
- All generated artifacts (code, comments, YAML, docs) are written in English.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `frontend/nginx/default.conf` | Serve Pamir; reject unknown hosts | 1 |
| `deploy/docker-compose.yml` | Parameterise the image tag | 2 |
| `render.yaml` (deleted) | Retired Render.com blueprint | 3 |
| `backend/.env.example` | Correct the stale Render header | 3 |
| `.nvmrc` | Pin Node 24 for CI | 4 |
| `.github/workflows/deploy.yml` | The whole pipeline | 4, 5, 6 |
| `README.md` | Describe the pipeline that now exists | 7 |

---

### Task 1: Stop nginx answering for foreign hosts

Both server blocks name `andinoclubpamir.app www.andinoclubpamir.app`, and nginx falls back to the first matching block for any unrecognised `Host`. That is why `riala.cl` currently serves the Pamir SPA.

**Consequence to be aware of:** after this task, `riala.cl` stops being served by this container. Until RIALA is deployed or its DNS is repointed, `https://riala.cl` will show a Cloudflare TLS error instead of the Pamir app. That is the intended outcome — it makes the misconfiguration visible instead of silently serving the wrong application — but it is a visible change.

**Files:**
- Modify: `frontend/nginx/default.conf`

**Interfaces:**
- Consumes: nothing
- Produces: an image whose nginx answers only for `andinoclubpamir.app`, `www.andinoclubpamir.app`, and `/healthz` on any host

- [ ] **Step 1: Write the failing test — observe today's wrong behaviour**

Build the current image and probe it with three different `Host` headers.

```bash
cd frontend
docker build -t pamir-frontend:hosttest .
docker run -d --rm --name pamir-hosttest -p 8088:80 pamir-frontend:hosttest
sleep 2

echo "--- Host: andinoclubpamir.app (expect 301 to https)"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: andinoclubpamir.app" http://127.0.0.1:8088/

echo "--- Host: riala.cl (MUST become 444; today it is 301)"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: riala.cl" http://127.0.0.1:8088/

echo "--- healthcheck path, Host: 127.0.0.1 (must stay 200)"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8088/healthz
```

- [ ] **Step 2: Run it and confirm the failure**

Expected today: `riala.cl` returns `301` (wrong — it should be refused). The other two are already correct and must stay correct.

Leave the container running; the same probes are reused in Step 5.

- [ ] **Step 3: Add the default-server blocks**

Insert these two blocks at the top of `frontend/nginx/default.conf`, immediately after the existing header comments and before the current `server { listen 80; ... }` block.

```nginx
# Default server on port 80: absorbs every unrecognised Host so this
# container never serves a domain that is not ours. /healthz lives here
# because Docker's HEALTHCHECK calls http://127.0.0.1/healthz, whose Host
# matches no server_name; without this the container reports unhealthy and
# backend's depends_on: service_healthy takes the whole stack down.
server {
    listen 80 default_server;
    server_name _;

    location = /healthz {
        return 200 "ok\n";
    }

    location / {
        return 444;
    }
}

# Default server on port 443: refuse the TLS handshake for any SNI that is
# not ours, rather than presenting a certificate issued for another domain.
server {
    listen 443 ssl default_server;
    ssl_reject_handshake on;
}
```

Leave both existing `server` blocks exactly as they are. They keep their explicit `server_name andinoclubpamir.app www.andinoclubpamir.app`, so named traffic still matches them ahead of the defaults.

- [ ] **Step 4: Rebuild**

```bash
cd frontend
docker rm -f pamir-hosttest
docker build -t pamir-frontend:hosttest .
docker run -d --rm --name pamir-hosttest -p 8088:80 pamir-frontend:hosttest
sleep 2
```

- [ ] **Step 5: Re-run the probes and verify they now pass**

```bash
echo "--- Host: andinoclubpamir.app"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: andinoclubpamir.app" http://127.0.0.1:8088/

echo "--- Host: riala.cl"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: riala.cl" http://127.0.0.1:8088/

echo "--- /healthz"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8088/healthz
```

Expected: `301`, then `000` (nginx closes the connection — `444` sends no response, so curl reports `000`), then `200`.

The middle result is the one that changed. The third is the regression guard: if it is not `200`, the healthcheck is broken and the stack will not come up.

- [ ] **Step 6: Verify nginx itself accepts the config**

```bash
docker exec pamir-hosttest nginx -t
```

Expected: `syntax is ok` and `test is successful`.

- [ ] **Step 7: Tear down and commit**

```bash
docker rm -f pamir-hosttest
cd ..
git add frontend/nginx/default.conf
git commit -m "fix(nginx): refuse hosts this container does not serve"
```

---

### Task 2: Pin deployments to an identifiable image tag

With `image: ...:latest` hardcoded, the running version cannot be named and rollback is guesswork.

Docker Compose interpolates `${PAMIR_TAG}` from a `.env` file in the **project directory**. On the VPS the compose file lives in `/opt/pamir/` and the env file is `/opt/pamir/.env`, so the existing layout already satisfies this. Note the two distinct roles of that one file: `env_file:` injects its contents into the container, while the same file — because it is named `.env` and sits beside the compose file — is also what Compose reads for interpolation.

**Files:**
- Modify: `deploy/docker-compose.yml`

**Interfaces:**
- Consumes: nothing
- Produces: `PAMIR_TAG`, an environment variable the deploy job (Task 6) writes into `/opt/pamir/.env`

- [ ] **Step 1: Write the failing test**

`docker compose config` cannot run against the real file locally, because `env_file: /opt/pamir/.env` does not exist on a development machine. Test against a temporary copy that points at an empty env file instead.

```bash
TMP=$(mktemp -d)
: > "$TMP/.env"
sed 's|/opt/pamir/.env|'"$TMP"'/.env|' deploy/docker-compose.yml > "$TMP/docker-compose.yml"

echo "--- with PAMIR_TAG set (expect sha-abc1234)"
PAMIR_TAG=sha-abc1234 docker compose -f "$TMP/docker-compose.yml" config | grep "image:"

echo "--- with PAMIR_TAG unset (expect latest)"
docker compose -f "$TMP/docker-compose.yml" config | grep "image:"
```

- [ ] **Step 2: Run it and confirm the failure**

Expected today: both runs print `:latest` for all three services. The first run should have printed `sha-abc1234`.

- [ ] **Step 3: Parameterise the tag**

In `deploy/docker-compose.yml`, change the `image:` line of all three services — `nginx`, `backend` and `migrate`:

```yaml
    image: ghcr.io/rocobytes/pamir-frontend:${PAMIR_TAG:-latest}
```

```yaml
    image: ghcr.io/rocobytes/pamir-backend:${PAMIR_TAG:-latest}
```

`migrate` uses the backend image, so it takes the same line as `backend`. All three must move together: a deployment where the migration runs a different build than the server is exactly the inconsistency this prevents.

- [ ] **Step 4: Re-run the test**

```bash
TMP=$(mktemp -d)
: > "$TMP/.env"
sed 's|/opt/pamir/.env|'"$TMP"'/.env|' deploy/docker-compose.yml > "$TMP/docker-compose.yml"

PAMIR_TAG=sha-abc1234 docker compose -f "$TMP/docker-compose.yml" config | grep "image:"
docker compose -f "$TMP/docker-compose.yml" config | grep "image:"
```

Expected: the first run prints `sha-abc1234` three times; the second prints `latest` three times.

- [ ] **Step 5: Commit**

```bash
git add deploy/docker-compose.yml
git commit -m "build(deploy): pin container images to an explicit tag"
```

---

### Task 3: Retire the Render-era leftovers

`render.yaml` is a complete Render.com blueprint whose environment still references `GOOGLE_DRIVE_FOLDER_ID`. Render and Google Drive are both retired. `backend/.env.example` still opens by telling the reader that Render injects these variables.

**Files:**
- Delete: `render.yaml`
- Modify: `backend/.env.example` (header comment only)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Confirm nothing references the blueprint**

```bash
grep -rn "render.yaml\|render\.com\|RENDER" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yml" --include="*.md" . | grep -v node_modules | grep -v backend/dist
```

Expected: matches only in `render.yaml` itself, in `backend/.env.example`, and in prose inside `README.md`. If any TypeScript file reads a `RENDER*` environment variable, stop and report it — that would mean the retirement is incomplete and is outside this task's scope.

- [ ] **Step 2: Delete the blueprint**

```bash
git rm render.yaml
```

- [ ] **Step 3: Fix the header of `backend/.env.example`**

Replace the opening comment that names Render with one describing the real deployment:

```
# Variables de entorno del backend.
# En produccion viven en /opt/pamir/.env (chmod 600) del VPS, y el
# contenedor las recibe por env_file desde deploy/docker-compose.yml.
# En desarrollo, copia este archivo a .env y completa los valores.
```

Leave every variable name and every other comment untouched.

- [ ] **Step 4: Verify the backend still starts from the example**

```bash
cd backend
npx tsc --noEmit
cd ..
```

Expected: no errors. This only proves nothing referenced the deleted file; the env example is not compiled.

- [ ] **Step 5: Commit**

```bash
git add render.yaml backend/.env.example
git commit -m "chore: drop the retired Render.com blueprint"
```

---

### Task 4: Pin Node and add the verification stage

**Files:**
- Create: `.nvmrc`
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: nothing
- Produces: jobs `verify-backend` and `verify-frontend`, which Task 5's `images` job declares in its `needs:`

- [ ] **Step 1: Write the failing test — run the CI commands in a clean environment**

The spec flags this as an unverified assumption: the suites pass locally, but locally there is a `.env` and a `node_modules` carrying a previously generated Prisma client. Reproduce a runner.

```bash
CLEAN=$(mktemp -d)
git clone --depth 1 "file://$(pwd)" "$CLEAN/repo"
cd "$CLEAN/repo/backend"
env -u DATABASE_URL -u JWT_SECRET npm ci
env -u DATABASE_URL -u JWT_SECRET npm run build
```

- [ ] **Step 2: Run it and confirm the failure**

Expected: `npm run build` fails, because `tsc` cannot resolve the generated Prisma client — no `prisma generate` has run in this clean tree. This is the exact failure the `prisma generate` step exists to prevent.

If the backend test suite also fails here, record the failing test names and report them before continuing: that is a real gap this pipeline would otherwise expose on its first run.

- [ ] **Step 3: Confirm the fix works in the clean tree**

```bash
cd "$CLEAN/repo/backend"
env -u DATABASE_URL -u JWT_SECRET npx prisma generate
env -u DATABASE_URL -u JWT_SECRET npm run lint
env -u DATABASE_URL -u JWT_SECRET npm test
env -u DATABASE_URL -u JWT_SECRET npm run build

cd "$CLEAN/repo/frontend"
npm ci && npm run lint && npm test && npm run build
```

Expected: all pass. Backend: 607 tests. Frontend: 182 tests.

- [ ] **Step 4: Create `.nvmrc`**

```
24
```

- [ ] **Step 5: Create the workflow with only the verification stage**

Create `.github/workflows/deploy.yml`:

```yaml
name: deploy

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

# Deployments touch a single production database. Never run two at once,
# and never cancel one midway: an interrupted migration is worse than a
# slow queue.
concurrency:
  group: deploy-production
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  verify-backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: backend/package-lock.json

      - run: npm ci

      # Required before the build: `npm run build` is a bare `tsc`, and on a
      # clean runner the generated Prisma client does not exist yet.
      - run: npx prisma generate

      - run: npm run lint
      - run: npm test
      - run: npm run build

  verify-frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

- [ ] **Step 6: Lint the workflow**

```bash
actionlint .github/workflows/deploy.yml
```

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add .nvmrc .github/workflows/deploy.yml
git commit -m "ci: verify both packages on every push"
```

---

### Task 5: Publish images to GHCR

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: jobs `verify-backend` and `verify-frontend` from Task 4
- Produces: job `images` with output `tag` (format `sha-<7 hex chars>`), consumed by Task 6's deploy job as `needs.images.outputs.tag`

- [ ] **Step 1: Append the images job**

Add to the end of `.github/workflows/deploy.yml`:

```yaml
  images:
    needs: [verify-backend, verify-frontend]
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      tag: ${{ steps.meta.outputs.tag }}
    steps:
      - uses: actions/checkout@v4

      - id: meta
        run: echo "tag=sha-$(git rev-parse --short HEAD)" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push the backend
        uses: docker/build-push-action@v6
        with:
          context: ./backend
          push: true
          tags: |
            ghcr.io/rocobytes/pamir-backend:latest
            ghcr.io/rocobytes/pamir-backend:${{ steps.meta.outputs.tag }}
          cache-from: type=gha,scope=backend
          cache-to: type=gha,mode=max,scope=backend

      # Built with no VITE_API_URL on purpose: the SPA falls back to a
      # relative /api, served same-origin by this image's own nginx.
      - name: Build and push the frontend
        uses: docker/build-push-action@v6
        with:
          context: ./frontend
          push: true
          tags: |
            ghcr.io/rocobytes/pamir-frontend:latest
            ghcr.io/rocobytes/pamir-frontend:${{ steps.meta.outputs.tag }}
          cache-from: type=gha,scope=frontend
          cache-to: type=gha,mode=max,scope=frontend
```

- [ ] **Step 2: Verify both images build locally from the same contexts**

```bash
docker build -t pamir-backend:citest ./backend
docker build -t pamir-frontend:citest ./frontend
```

Expected: both succeed. This proves the build contexts the workflow passes are correct before any push is attempted.

- [ ] **Step 3: Lint the workflow**

```bash
actionlint .github/workflows/deploy.yml
```

Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: publish tagged images to GHCR"
```

---

### Task 6: Deploy to the VPS behind an approval gate

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `needs.images.outputs.tag` from Task 5; `PAMIR_TAG` from Task 2
- Produces: nothing downstream

- [ ] **Step 1: Append the deploy job**

Add to the end of `.github/workflows/deploy.yml`:

```yaml
  deploy:
    needs: images
    runs-on: ubuntu-latest
    # Requires a reviewer on the `production` environment. The job queues
    # here and touches nothing until a human approves it.
    environment: production
    env:
      TAG: ${{ needs.images.outputs.tag }}
      VPS: ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}
    steps:
      - uses: actions/checkout@v4

      - name: Load the SSH credentials
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "${{ secrets.VPS_SSH_KEY }}" > ~/.ssh/id_deploy
          printf '%s\n' "${{ secrets.VPS_KNOWN_HOSTS }}" > ~/.ssh/known_hosts
          chmod 600 ~/.ssh/id_deploy ~/.ssh/known_hosts

      - name: Sync the deployment files
        run: |
          scp -i ~/.ssh/id_deploy deploy/docker-compose.yml "$VPS:/opt/pamir/docker-compose.yml"
          scp -i ~/.ssh/id_deploy deploy/check-alertas.sh "$VPS:/opt/pamir/bin/check-alertas.sh"
          ssh -i ~/.ssh/id_deploy "$VPS" "chmod +x /opt/pamir/bin/check-alertas.sh"

      - name: Pin this release in /opt/pamir/.env
        run: |
          ssh -i ~/.ssh/id_deploy "$VPS" "
            set -eu
            cd /opt/pamir
            grep -v '^PAMIR_TAG=' .env > .env.next || true
            echo 'PAMIR_TAG=$TAG' >> .env.next
            mv .env.next .env
            chmod 600 .env
          "

      - name: Pull the new images
        run: ssh -i ~/.ssh/id_deploy "$VPS" "cd /opt/pamir && docker compose pull"

      - name: Report pending migrations
        # `prisma migrate status` exits 1 when migrations are pending. That is
        # the expected, informative case, so it must not fail the job — the
        # point of this step is to print the list into the log.
        run: |
          ssh -i ~/.ssh/id_deploy "$VPS" \
            "cd /opt/pamir && docker compose run --rm migrate npx prisma migrate status" || true

      - name: Apply migrations
        run: ssh -i ~/.ssh/id_deploy "$VPS" "cd /opt/pamir && docker compose run --rm migrate"

      - name: Roll the containers
        run: |
          ssh -i ~/.ssh/id_deploy "$VPS" "
            set -eu
            cd /opt/pamir
            docker compose up -d --remove-orphans
            docker image prune -f
          "

      - name: Verify the deployment is healthy
        run: |
          for i in 1 2 3 4 5 6 7 8 9 10; do
            if curl -fsS https://andinoclubpamir.app/api/health; then
              echo "healthy after ${i} attempt(s)"
              exit 0
            fi
            echo "attempt ${i} failed; retrying"
            sleep 5
          done
          echo "backend never became healthy"
          exit 1
```

The order matters: `docker compose pull` runs before the migration steps so that `migrate` executes the newly built image, not the one already on disk.

- [ ] **Step 2: Lint the workflow**

```bash
actionlint .github/workflows/deploy.yml
```

Expected: no output, exit 0.

- [ ] **Step 3: Verify the full workflow parses as YAML**

```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/deploy.yml')); print(sorted(d['jobs'].keys()))"
```

Expected: `['deploy', 'images', 'verify-backend', 'verify-frontend']`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy to the VPS behind a manual approval gate"
```

---

### Task 7: Correct the README

`README.md` describes `.github/workflows/deploy.yml` as if it already existed, and its rollback instructions predate `PAMIR_TAG`.

**Files:**
- Modify: `README.md` (the CI/CD subsection, around lines 636-660)

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Read the current section**

```bash
sed -n '620,690p' README.md
```

- [ ] **Step 2: Rewrite it to describe what now exists**

The replacement section must state:
- Every push runs `verify-backend` and `verify-frontend`; pull requests run only those.
- Pushes to `main` additionally build and push `latest` and `sha-<commit>` to GHCR.
- The deploy job waits on the `production` environment until a reviewer approves it.
- Deployment writes `PAMIR_TAG` into `/opt/pamir/.env`, reports pending migrations, applies them, rolls the containers and verifies `/api/health`.
- Rollback: ssh to the VPS, edit `PAMIR_TAG` in `/opt/pamir/.env` to an earlier `sha-` tag, then `docker compose up -d`.
- Required repository settings: secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, plus a `production` environment with a required reviewer.

- [ ] **Step 3: Verify no stale claims remain**

```bash
grep -n "Render\|render.yaml\|Google Drive" README.md
```

Expected: matches only where the README deliberately records that these were retired. Any sentence still describing them as current must be corrected.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(ci): describe the deployment pipeline"
```

---

## Owner setup (cannot be automated)

These must exist before Task 6's deploy job can succeed. The pipeline cannot create them.

| Setting | Where |
|---------|-------|
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` | Repository secrets |
| Environment `production` with a required reviewer | Repository settings → Environments |
| GHCR packages linked to this repository | Package settings, so `GITHUB_TOKEN` may push |

Generate `VPS_KNOWN_HOSTS` with `ssh-keyscan -H 169.58.210.134`. Pinning it is what stops the deploy from trusting an unknown server.

## Open item, outside this plan

The origin certificate on the VPS covers only `*.andinoclubpamir.app` and `andinoclubpamir.app`, yet `https://riala.cl` currently returns 200. That is only possible if the `riala.cl` Cloudflare zone is not set to Full (strict), meaning that leg is not validating the origin certificate. Review it in the Cloudflare panel.
