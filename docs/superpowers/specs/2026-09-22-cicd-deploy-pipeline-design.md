# CI/CD Deployment Pipeline — Design

**Date:** 2026-09-22
**Status:** Approved, pending implementation plan
**Scope:** Pamir only (`andinoclubpamir.app`). RIALA is a separate, undeployed project.

## Context

The repository has no CI. `.github/` has never existed in any commit, yet `README.md`
documents `.github/workflows/deploy.yml` in full detail — image names, deploy steps and
four required secrets — as if it were present. Everything that file would orchestrate is
already built and committed: both Dockerfiles, `deploy/docker-compose.yml`,
`frontend/nginx/default.conf` and `deploy/check-alertas.sh`. Only the workflow is missing.

### Verified production state (measured 2026-09-22)

| Fact | Evidence |
|------|----------|
| VPS is live and fully provisioned | `169.58.210.134`, `Host pamir` in `~/.ssh/config` |
| Cloudflare proxy and TLS work | `GET https://andinoclubpamir.app/` → 200, `server: cloudflare` |
| Backend is up | `GET /api/health` → 200 `{"status":"ok"}` |
| Deployed build is stale | `last-modified: Wed, 16 Sep 2026 21:33:53 GMT` |
| The merged work is NOT deployed | production serves `index-CCmIlVcz.js` and has no `motion-*.js` chunk; `GET /api/clubes/pamir/logo` → 404 |
| One nginx answers for every host | `riala.cl` and `andinoclubpamir.app` return byte-identical `index.html` and the same ETag `W/"6aab0b41-aacdc"` |
| Origin certificate covers only one domain | SAN = `*.andinoclubpamir.app`, `andinoclubpamir.app` |

Production therefore trails `main` by 43 commits, and the Pamir container currently answers
for `riala.cl` because its nginx has no `default_server` guard.

## Goals

1. Verify every push automatically; never ship a red build.
2. Publish immutable, identifiable images to GHCR.
3. Put the step that touches production behind an explicit human approval.
4. Make rollback a deterministic operation, not an archaeology exercise.
5. Stop the Pamir container from serving domains that do not belong to it.

## Non-goals

- Provisioning or bootstrapping the VPS. It already runs.
- Deploying, configuring or planning RIALA.
- Changing Pamir's domain. It stays on `andinoclubpamir.app`, which is what the origin
  certificate covers.
- Staging or preview environments.

## Architecture

One new file, `.github/workflows/deploy.yml`, with three chained stages.

```
push/PR ──▶ [1] verify ──▶ [2] images ──▶ ⏸ approval ──▶ [3] deploy
             both pkgs      GHCR push      environment     ssh + compose
```

### Stage 1 — verify

Runs on every push to `main` and on every pull request. Two parallel jobs.

- **backend**: `npm ci` → `prisma generate` → `npm run lint` → `npm test` → `npm run build`
- **frontend**: `npm ci` → `npm run lint` → `npm test` → `npm run build`

`prisma generate` is mandatory and must precede the build. `backend`'s build script is a
bare `tsc`, so on a clean runner the generated Prisma client does not exist and compilation
fails. It currently succeeds locally only because `node_modules` retains a client from an
earlier `predev` run. `backend/Dockerfile` already chains the two for the same reason.

Node is pinned to 24 through a new `.nvmrc`, matching the `node:24-bookworm-slim` base image
in both Dockerfiles. The repository has no `engines` field and no `.nvmrc` today, so the
image tag is the only existing source of truth for the version.

No npm `db:*` script may run in CI. Each one carries a `pre*` hook that invokes `db:guard`
(`assert-db-target.ts`), which aborts unless `DATABASE_URL`'s host matches
`allowedHostFragment` in `backend/db-target.json`.

### Stage 2 — images

Runs only on `main`, only if stage 1 passed. Buildx builds both images and pushes them to
GHCR with two tags each:

- `ghcr.io/rocobytes/pamir-backend:latest` and `:sha-<short-commit>`
- `ghcr.io/rocobytes/pamir-frontend:latest` and `:sha-<short-commit>`

Authentication uses the workflow's own `GITHUB_TOKEN` with `packages: write`; no stored
secret is needed. Layer caching goes through the GitHub Actions cache.

The frontend image is built with no `VITE_API_URL`, preserving the deliberate choice
documented in `frontend/Dockerfile`: the SPA falls back to a relative `/api`, served
same-origin by the container's own nginx, which avoids CORS entirely.

### Stage 3 — deploy

Guarded by a GitHub Environment named `production` with a required reviewer. The job is
queued and waits; nothing touches the VPS until a human approves it.

1. Load the SSH key and known hosts from secrets.
2. Copy `deploy/docker-compose.yml` and `deploy/check-alertas.sh` to `/opt/pamir/`.
3. `docker compose pull`
4. `docker compose run --rm migrate npx prisma migrate status` — **reports only**
5. `docker compose run --rm migrate` — applies migrations
6. `docker compose up -d --remove-orphans`
7. Prune dangling images
8. Verify `GET /api/health` returns 200; fail the job otherwise

A `concurrency` group serialises deployments. Two overlapping runs applying migrations to
the same database is the failure mode this prevents.

## Component changes

### `deploy/docker-compose.yml` — parameterise the tag

All three services move from `image: ...:latest` to `image: ...:${PAMIR_TAG:-latest}`,
with `PAMIR_TAG` written into `/opt/pamir/.env` by the deploy job.

Without this there is no real rollback: every deployment points at a moving `latest` and the
running version cannot be named. With it, rolling back is re-running the workflow against an
earlier commit SHA, which is exactly the recovery path `README.md` already describes.

### `frontend/nginx/default.conf` — reject unknown hosts

Today both server blocks name `andinoclubpamir.app www.andinoclubpamir.app`, and nginx falls
back to the first block for any unmatched `Host`. Two observable consequences: `riala.cl`
serves the Pamir SPA, and `http://riala.cl` 301-redirects to `https://andinoclubpamir.app/`
because the redirect target is hardcoded.

Add a `default_server` pair that terminates unknown traffic:

- port 80 `default_server`: serve `/healthz`, return `444` for everything else
- port 443 `default_server`: `ssl_reject_handshake on` (available in the `nginx:1.29-alpine` image the frontend already builds on)

`ssl_reject_handshake` avoids inventing a certificate for hosts the server should not answer
for at all.

**Constraint that must not be missed:** the frontend `HEALTHCHECK` runs
`wget -q --spider http://127.0.0.1/healthz`, sending `Host: 127.0.0.1`, which matches no
named block. `/healthz` must therefore remain reachable on the port 80 `default_server`. If
it is not, the container reports unhealthy, and `backend`'s `depends_on: service_healthy`
brings the whole stack down with it.

### Retired-architecture cleanup

- Delete `render.yaml`. It is a complete Render.com Blueprint whose build command still ends
  in `npm run db:deploy` and whose env vars still reference `GOOGLE_DRIVE_FOLDER_ID`. Both
  Render and Google Drive are retired.
- Rewrite the header comment of `backend/.env.example`, which still reads
  "Render.com inyecta estas variables directamente".

### `README.md`

Correct the CI/CD section so it describes the workflow that now exists, including the
approval gate, the `PAMIR_TAG` rollback procedure and the migration-status step.

## Migration safety

`prisma migrate deploy` runs inside the `migrate` service via `npx`, not through an npm
script, so the `db:guard` pre-hook never fires. This is verified and intentional: the guard
exists to stop a developer's local command from reaching the wrong Neon project, and it must
not block the production deploy path.

Because production trails `main` by 43 commits, the first run will apply a backlog against
the live Neon database. Splitting the step in two — `migrate status` to report, then
`migrate deploy` to apply — guarantees that nothing is written before the pending list is
printed. It does **not** put that list in front of the approver: both steps run inside the
`production`-gated `deploy` job, and the environment gate fires before the job starts, so the
approver has already clicked Approve by the time `migrate status` prints. For a genuinely
informed approval, the approver must ssh to the VPS and run
`cd /opt/pamir && docker compose run --rm migrate npx prisma migrate status` before approving.

`backend/prisma/migrations/` holds 29 migration directories, the most recent being
`20260922120000_add_organization_logo`. How many are unapplied in production is unknown from
outside and will be revealed by the first `migrate status` run — or, before approving, by that
manual `migrate status` check.

## Rollback

Re-run the workflow with an earlier commit SHA. Stage 3 sets `PAMIR_TAG=sha-<that-commit>`
and rotates the containers onto the previously published images.

Database migrations are not rolled back automatically. Prisma has no down-migration path
here, so a schema change that must be reverted requires a new forward migration. This is a
property of the existing setup, not something this design introduces.

## Required secrets and settings

Created by the repository owner; the pipeline cannot provision them.

| Name | Purpose |
|------|---------|
| `VPS_HOST` | VPS address |
| `VPS_USER` | Deploy user |
| `VPS_SSH_KEY` | Private key for that user |
| `VPS_KNOWN_HOSTS` | Pinned host key, so the deploy never blindly trusts an unknown server |

These four must be **environment secrets on the `production` environment**, not repository
secrets. A repository secret is readable by any job in any workflow in the repository,
including one added on a same-repository branch; only the `deploy` job is gated, so a
repository secret's exposure is not limited by that gate at all. The `deploy` job already
declares `environment: production`, so every `${{ secrets.VPS_* }}` reference resolves
unchanged, and no other job in the repository can read them.

Plus a GitHub Environment named `production` with the owner as required reviewer, and GHCR
packages linked to the repository so `GITHUB_TOKEN` is allowed to push.

## Risks

| Risk | Mitigation |
|------|-----------|
| First deploy applies a large migration backlog | `migrate status` runs before `migrate deploy` inside the gated job, guaranteeing nothing is written before it prints — but the approver does not see that printout before approving (see Migration safety); the approver must run `prisma migrate status` on the VPS by hand first |
| Unverified assumption that tests pass in a clean environment | The plan must run the suite with no local `.env` present; some tests may read environment variables |
| `riala.cl` zone is not Full (strict) | Out of scope here, but flagged: the origin certificate does not cover `riala.cl`, so that leg is not validating. Owner to review in the Cloudflare panel |
| SSH key stored in GitHub | Scope the deploy user to what it needs; stored as an environment secret on `production`, so only the gated `deploy` job can read it and the approval gate limits when it is used |
