# Final Whole-Branch Review — Remaining Findings

Continuation of the review of `ci/deploy-pipeline` (base `001dda0`, head `bcbe523`).
Contains: the remainder of Important I1, findings I2 and I3, all Minor findings, and the
full First-Run Risks list. The Verdict, Spec and Plan Alignment, triage items 1-7 and the
four ruling assessments were delivered separately and are not repeated here.

---

## Important (Should Fix Before Merge)

### I1 — The migration backlog is approved blind (continued)

**Location:** `.github/workflows/deploy.yml:157-166`, against spec:160-162 and the spec risk
table at spec:195.

**Recap of the defect.** The spec's mitigation for its own top-listed risk reads: "Splitting
the step in two — `migrate status` to report, then `migrate deploy` to apply — means the
human approving the deployment sees the exact list of pending migrations in the job log
before anything is written." Both steps live *inside* the gated `deploy` job. The
environment gate fires before the job starts, so the approver sees nothing; `migrate status`
prints, and `migrate deploy` runs seconds later with no further checkpoint. On the first run
that is a backlog of up to 29 migrations against live Neon data.

**You are right that this is a spec defect, not an implementation defect.** The
implementation faithfully built what the plan described, and `README.md:648-655` is honest
about the real ordering — it lists both the status print and the apply under "Con esa
aprobación". Only the spec overclaims. But the protection the design was sold on does not
exist, and it is absent on exactly the run this branch exists to enable.

#### Recommendation

**Yes, there is a way to restore informed approval without splitting into two workflows.**
Three options, in ascending order of effort.

##### Option A — Minimum, ship-blocking (documentation only)

Correct spec:160-162 and the spec risk table, and add one line to the README and to your own
first-run checklist:

> Before approving, ssh to the VPS and run
> `cd /opt/pamir && docker compose run --rm migrate npx prisma migrate status`.

This restores informed approval through a human step rather than a pipeline step. It costs
nothing and it is the minimum required for the spec and the implementation to agree. Do this
regardless of whether you also do B or C.

##### Option B — Concrete fix, still one workflow (recommended)

Add a third job between `images` and `deploy`, in the same file:

```yaml
  migrate-status:
    needs: images
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # Second GitHub Environment, with NO required reviewers, so this job
    # starts immediately and its output is on the run page before the
    # approval prompt for `deploy` is ever reached.
    environment: production-inspect
    env:
      VPS: ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}
    steps:
      - name: Load the SSH credentials
        run: |
          umask 077
          mkdir -p ~/.ssh
          printf '%s\n' "${{ secrets.VPS_SSH_KEY_READONLY }}" > ~/.ssh/id_inspect
          printf '%s\n' "${{ secrets.VPS_KNOWN_HOSTS }}" > ~/.ssh/known_hosts

      - name: Report pending migrations
        run: |
          {
            echo '## Pending migrations'
            echo '```'
            ssh -o BatchMode=yes -o ConnectTimeout=10 -i ~/.ssh/id_inspect "$VPS" true 2>&1 || true
            echo '```'
          } >> "$GITHUB_STEP_SUMMARY"
```

and change the `deploy` job's dependency to:

```yaml
    needs: [images, migrate-status]
```

Because `deploy` cannot be reached until `migrate-status` finishes, **the approval prompt now
appears after the pending list is already rendered on the run page**. That is genuine
informed approval, in one workflow, with one extra job. Writing the output to
`$GITHUB_STEP_SUMMARY` rather than only to the log matters: the approver sees it on the run
summary page they are already looking at when they click Approve, instead of having to open a
job log.

##### The tension you need to know about, and how to resolve it (Option C)

Option B interacts with finding I2 below. If the VPS secrets move to the `production`
environment — which I2 recommends — then an **ungated** `migrate-status` job cannot read
them. And if you leave them at repository scope so it can, you have reopened exactly the hole
I2 closes.

Resolve it by giving `production-inspect` its own secret set containing a **second, restricted
SSH key**. On the VPS, that key's entry in `~/.ssh/authorized_keys` carries a forced command:

```
command="cd /opt/pamir && docker compose run --rm migrate npx prisma migrate status",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... deploy-inspect
```

With that in place, the ungated job physically cannot do anything except print the migration
status — the remote command it sends is ignored and the forced command runs instead, which is
why the `ssh ... true` in the snippet above is sufficient and deliberate. The unrestricted key
stays behind the reviewer gate on `production`.

**This (B + C together) is the version I would actually build.** Without the forced command,
Option B trades I2 back for I1 and you gain nothing net.

---

### I2 — The four VPS secrets are documented as repository secrets, which the approval gate does not protect

**Location:** `README.md:662`; also spec:181-189 and the plan's "Owner setup" table.

Repository secrets are readable by **any** job in **any** workflow in the repository,
including a job added on a pull-request branch by any account with write access. Only the
`deploy` job is gated. So the approval gate limits *when the SSH key is used by this
workflow* — it does not limit *who can read it*. Spec:198 offers "the approval gate limits
when it can be used" as the mitigation for the risk "SSH key stored in GitHub"; that claim
only holds for environment secrets.

Fork pull requests are already safe — they receive no secrets at all, and `permissions:
contents: read` at `deploy.yml:9-10` keeps the token read-only. The exposed path is a
same-repository branch, i.e. an insider or a compromised collaborator account.

**Fix — costs nothing in the workflow.** Store `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` and
`VPS_KNOWN_HOSTS` as **environment secrets on `production`** rather than repository secrets.
The `deploy` job already declares `environment: production` (`deploy.yml:108`), so every
`${{ secrets.VPS_* }}` reference at `:118`, `:125` and `:126` resolves unchanged, and no
other job in the repository can read them.

Then update:
- `README.md:662` — "Secrets del repositorio" becomes "Secrets del entorno `production`".
- The spec's "Required secrets and settings" table (spec:181-189).
- The plan's "Owner setup (cannot be automated)" table.

---

### I3 — Nothing in the deploy job has a timeout, and it holds the deployment concurrency group

**Locations:**
- `.github/workflows/deploy.yml:103-118` — no `timeout-minutes` on the `deploy` job.
- `.github/workflows/deploy.yml:131-133, 155, 163, 166, 170` — no `BatchMode` or
  `ConnectTimeout` on any `ssh` or `scp`.
- `.github/workflows/deploy.yml:180` — `curl -fsS` with no `--max-time` or
  `--connect-timeout` (this is deferred triage item 6, folded in here).

A stalled TCP connection to the VPS, or a `curl` that connects and never returns, runs to the
360-minute default job timeout **while holding the `deploy-production` concurrency group**
declared at `:113-115`. Every subsequent deployment queues behind it. The health loop at
`:179-186` is documented as a bounded ~50-second retry budget and is currently unbounded: ten
iterations of a `curl` that can each hang indefinitely.

This matters more than the equivalent gap on the verify jobs (deferred triage item 3, which I
ruled acceptable to defer) precisely because of the concurrency group: a hung verify job
wastes CI minutes, a hung deploy job blocks the pipeline's whole reason for existing.

**Fix:**

1. Add `timeout-minutes: 20` to the `deploy` job.
2. Add `-o BatchMode=yes -o ConnectTimeout=10` to every `ssh` and `scp` invocation. Cleanest
   as an `SSH_OPTS` entry in the job-level `env` block, or by writing them into
   `~/.ssh/config` in the "Load the SSH credentials" step at `:122-127`:

   ```
   Host *
     BatchMode yes
     ConnectTimeout 10
     ServerAliveInterval 15
     ServerAliveCountMax 4
   ```

   `ServerAliveInterval`/`ServerAliveCountMax` additionally bound the *mid-transfer* stall
   case, which `ConnectTimeout` alone does not cover — relevant for the long-running
   `migrate deploy` step at `:166`.
3. Change `:180` to `curl -fsS --connect-timeout 5 --max-time 10`.

---

## Minor (Nice to Have)

### M1 — The `grep -v` exit-status comment is factually wrong

**Location:** `.github/workflows/deploy.yml:144-145`. (Deferred triage item 5; I ruled
**fix before merge**, one line.)

The comment claims `grep -v` exits non-zero "when nothing matches, the normal case on a first
deploy". It does not. `grep -v` exits 0 when it *selects* at least one line — and on a first
deploy a populated `.env` with no `PAMIR_TAG=` line means every line is selected, so it exits
0. Exit 1 happens only when no lines are output: an empty `.env`, or one containing nothing
but `PAMIR_TAG=` lines.

No functional bug — `test -s .env.next` at `:148` backstops it — but this is the one block in
the repository that rewrites production secrets, and the comment teaches the next maintainer a
false fact about the exit status they would reason from when editing it.

**Suggested replacement:**

```
# `grep -v` exits non-zero when it selects no lines at all — an empty .env,
# or one holding only PAMIR_TAG= lines — so its status must not abort the
# step...
# ...and `test -s` below is what actually catches that case, because an
# empty result means we are about to wipe the file.
```

### M2 — Secrets briefly world-readable on the long-lived VPS

**Location:** `.github/workflows/deploy.yml:146-151`. (Related to deferred triage item 4,
which covered the runner side at `:125-127`.)

`grep -v '^PAMIR_TAG=' .env > .env.next` creates `.env.next` through a shell redirect under
the deploy user's umask — typically 0022, so mode 0644 — and that file holds **every
production secret** until `chmod 600 .env` runs two lines after the `mv`. Between `mv
.env.next .env` at `:150` and `chmod 600 .env` at `:151`, the live `.env` is also 0644.

I ruled the equivalent pattern on the GitHub runner acceptable to defer, because a
GitHub-hosted runner is an ephemeral, single-tenant VM with no other process to read the file.
That reasoning does **not** transfer to the VPS, which is long-lived and may have other
accounts.

**Fix — one line.** Add `umask 077` immediately after `set -eu` at `:138`. That covers
`.env.next` at creation *and* the post-`mv` window, and makes the existing `chmod 600` at
`:151` belt-and-braces rather than the only protection. The same one-liner added before `:125`
closes the runner-side case (deferred item 4) at zero extra cost, which is why I would do both
in the same commit even though I ruled the runner side deferrable on its own.

### M3 — `chmod +x` contradicts the script's own documented install permission

**Location:** `.github/workflows/deploy.yml:133` versus `deploy/check-alertas.sh:6`.

`chmod +x` under a default umask yields 0755. The script's own header comment states:
"Instalar en el VPS como /opt/pamir/bin/check-alertas.sh (chmod 700)".

The secret itself is not exposed — `check-alertas.sh:13` reads `CRON_SECRET` from
`/opt/pamir/.env`, which is mode 600 — so the practical impact is low. But the workflow
silently overrides the contract the file documents for itself, and a reader comparing the two
cannot tell which is authoritative.

**Fix:** `chmod 700 /opt/pamir/bin/check-alertas.sh`.

### M4 — `scp` overwrites a possibly-running script in place

**Location:** `.github/workflows/deploy.yml:132`.

`scp` truncates the destination and rewrites it. Bash reads a script incrementally, by byte
offset, as it executes — so if the every-10-minutes cron happens to be running
`check-alertas.sh` at that moment, the running shell can resume reading at an offset that now
contains different content and misparse.

The `flock` in the crontab does not help: it serializes cron invocations against each other,
not against an external writer.

Probability is low (the script is a handful of lines and finishes fast), but the fix is free.

**Fix:** copy to a temporary name and rename atomically:

```bash
scp ... deploy/check-alertas.sh "$VPS:/opt/pamir/bin/check-alertas.sh.new"
ssh ... "$VPS" "chmod 700 /opt/pamir/bin/check-alertas.sh.new && mv /opt/pamir/bin/check-alertas.sh.new /opt/pamir/bin/check-alertas.sh"
```

`mv` within the same filesystem is a rename, so a running instance keeps its original inode
and finishes cleanly.

### M5 — VPS disk grows without bound

**Location:** `.github/workflows/deploy.yml:174`.

`docker image prune -f` removes **dangling** images only — untagged layers with no reference.
Every deploy pulls a new `sha-<commit>` tag that stays tagged forever, so it is never
dangling and never reclaimed. And `:latest` is never pulled onto the VPS at all by this
pipeline, because `deploy/docker-compose.yml:8,22,38` resolve `${PAMIR_TAG:-latest}` to the
sha tag written into `/opt/pamir/.env`.

Net effect: roughly one backend image plus one frontend image accumulate per deploy,
permanently. On a Contabo VPS that is months rather than weeks, but it is unbounded and it
will eventually take production down in the least obvious way possible.

**Fix:**

```bash
docker image prune -af --filter "until=720h"
```

The `until` filter is what makes `-a` safe here: it reclaims images older than 30 days while
leaving recent `sha-` tags on disk, which are exactly the rollback targets the README's
rollback procedure (`README.md:668-669`) depends on being present.

### M6 — Two failure modes the deploy script swallows

**Location A:** `.github/workflows/deploy.yml:149`.

`echo 'PAMIR_TAG=$TAG' >> .env.next` writes unconditionally. `$TAG` expands on the *runner*
(the surrounding ssh argument is double-quoted, so the single quotes are literal characters
passed through to the remote shell — the quoting is correct as written). But if
`needs.images.outputs.tag` were ever empty, this writes `PAMIR_TAG=`, and because compose uses
`${PAMIR_TAG:-latest}` an empty value falls back to `:latest` — a silent, unpinned deployment
of whatever `latest` currently points at.

The reachable paths are narrow (if `images` is skipped, `deploy` is skipped; if the `meta`
step fails, the job fails), but the failure is silent and the guard is one line.

**Fix:** `test -n "$TAG"` before the ssh block, or `${TAG:?}` at the point of use.

**Location B:** `.github/workflows/deploy.yml:161-163`.

The trailing `|| true` sits *outside* the ssh quoting, so it swallows ssh connection failures,
authentication failures and host-key mismatches in addition to the intended `prisma migrate
status` exit 1. The comment at `:158-160` correctly explains the intent (exit 1 means
"migrations pending", which is informative rather than fatal) but the implementation is
broader than the intent.

**Fix:** move the tolerance inside the remote command —
`"cd /opt/pamir && docker compose run --rm migrate npx prisma migrate status || true"` — so
the ssh transport itself still fails loudly. The next step would fail anyway, but it would
fail with a confusing error rather than an obvious one.

### M7 — Stale Render/Vercel comments in application code

**Locations:** `backend/src/app.ts:9`, `backend/src/routes/health.route.ts:7`,
`frontend/src/lib/api.ts:24`. (Deferred triage item 1 — **acceptable to defer**.)

All three are comments; the code they annotate is correct. Specifically, `app.set('trust
proxy', 1)` is the right setting for the single-entry `X-Forwarded-For` that nginx sets at
`frontend/nginx/default.conf:78` — only the comment's attribution to Render is stale, since
the proxy is now Cloudflare plus the container's own nginx.

`health.route.ts:7` is the most actively misleading of the three: it asserts a 14-minute
external cron ping that `CLAUDE.md` explicitly records as obsolete, and a future reader could
reasonably act on it.

Worth one follow-up commit after merge. None of them changes behaviour.

### M8 — `frontend/vercel.json` survives the retired-architecture cleanup

**Location:** `frontend/vercel.json`.

It is the same class of artifact as the deleted `render.yaml`: a retired-platform deployment
descriptor. Its single rewrite rule is explicitly superseded — `frontend/nginx/default.conf:94`
carries the comment "Fallback del SPA (reemplaza el rewrite de frontend/vercel.json)" — and
`frontend/.dockerignore` already excludes it from the image, so it has no runtime effect.

**Not a defect of this branch:** spec:141-146 names only `render.yaml` for deletion, so the
task correctly stayed in scope. But the retirement is now visibly incomplete, and the next
reader will wonder why one went and the other stayed. Either delete it in a follow-up or note
in the README why it is kept.

### M9 — The manual rollback is not sticky

**Location:** `README.md:668-669`.

The documented rollback — ssh to the VPS, set `PAMIR_TAG` in `/opt/pamir/.env` to an earlier
`sha-` tag, `docker compose up -d` — works, but the **next approved deploy rewrites
`PAMIR_TAG`** at `deploy.yml:146-151` and silently rolls forward onto the build you rolled away
from. Anyone who rolls back on a Friday and merges on Monday gets the bad build again without
a single warning.

**Fix (documentation):** add to the README's rollback paragraph that (a) the durable fix is a
revert commit, not an env edit, and (b) the gated alternative is re-running the `deploy` job of
the earlier successful run — that path still works, because `needs.images.outputs.tag` is
replayed from the original run and `actions/checkout` restores that run's `github.sha`.

This also reconciles the README with spec:116 and spec:168-175, which still describe rollback
as "re-run the workflow with an earlier commit SHA".

### M10, M11, M12 — Deferred items, restated for completeness

- **M10** — deferred triage item 2: `actions/checkout@v4`, `actions/setup-node@v4`,
  `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/build-push-action@v6` are
  pinned to mutable major tags rather than commit SHAs. **Acceptable to defer**: all five come
  from the `actions/` and `docker/` organisations, and without a `dependabot.yml` (none exists;
  `.github/` contains only `workflows/deploy.yml`) SHA pins go stale and silently miss security
  patches — the worse failure mode for a solo-maintained repository. Revisit if Dependabot for
  `github-actions` is ever added.
- **M11** — deferred triage item 3: no `timeout-minutes` on `verify-backend` or
  `verify-frontend`. **Acceptable to defer**; a hung test wastes minutes, it does not block the
  pipeline. Contrast I3, where the same omission on `deploy` does block it.
- **M12** — deferred triage item 7: `README.md:638,640` list formatting. **Acceptable to
  defer**; at HEAD those lines are prose in the section's intro paragraph, not list items, so I
  could not reproduce the inconsistency. It likely referred to a pre-final revision.

---

## First-Run Risks

Production trails `main` by 43 commits, so run number one is the least routine thing this
pipeline will ever do. What the repository owner should check or know before approving it.

### 1. Back up the database, then read the migration list yourself

Take a Neon branch or backup before approving. Then ssh to the VPS and run:

```bash
cd /opt/pamir && docker compose run --rm migrate npx prisma migrate status
```

As built, the pipeline will **not** show you this before you approve — see I1. Up to 29
migration directories exist under `backend/prisma/migrations/`, and how many are unapplied in
production is unknown from outside.

### 2. Prisma Migrate over the pooled Neon endpoint is unverified

`README.md:699` and `backend/.env.example:8` both specify the **pooled** (`-pooler.`) Neon
endpoint, and there is no `directUrl` anywhere: `backend/prisma/schema.prisma:6-8` declares a
bare datasource and `backend/prisma.config.ts:11-13` feeds it `DATABASE_URL` directly.

Prisma Migrate takes a session-scoped advisory lock, which is a known failure mode under
PgBouncer transaction pooling. Confirm what `DATABASE_URL` in `/opt/pamir/.env` actually
points at before approving. If it is the pooler, plan on giving the `migrate` service a
direct, unpooled URL — a separate `DIRECT_DATABASE_URL` in `/opt/pamir/.env` plus a
`migrate`-scoped `environment:` override in `deploy/docker-compose.yml` is the smallest change
that achieves it.

This is a pre-existing property of the setup, not something this branch introduces — but this
branch is what will exercise it, automatically, against 43 commits of backlog.

### 3. GHCR access is established in one direction only

The pipeline logs in to **push** (`deploy.yml:73-77`, using `GITHUB_TOKEN` with
`packages: write`). Nothing logs the VPS in to **pull**. If the packages are private,
`docker compose pull` at `:155` fails unless the VPS still holds credentials from the earlier
manual deploys.

Separately, on the push side: if the packages were first created by a local `docker push` from
a workstation rather than by the repository, they are owned by the user and not linked to the
repository, and `GITHUB_TOKEN` will get a 403. Check Package settings → Manage Actions access
before the first run.

### 4. `VPS_KNOWN_HOSTS` must match `VPS_HOST` exactly

`ssh-keyscan -H 169.58.210.134` (the command the plan documents) produces **hashed** entries
keyed to that IP string. If `VPS_HOST` is set to a hostname instead of that exact IP, host key
verification fails and the deploy stops at the first `scp` with an error that looks like a
network problem rather than a configuration one.

### 5. VPS preconditions the pipeline does not create

- `/opt/pamir/bin/` must already exist — `scp` will not create a missing directory
  (`deploy.yml:132`).
- `/opt/pamir/.env` must exist and be non-empty — the step refuses otherwise, by design
  (`:143`, `:148`). This is correct behaviour, but it means the first run fails loudly if the
  file is missing.
- `VPS_USER` needs write access to `/opt/pamir/` (to create `.env.next` and `mv` it) and
  membership in the `docker` group.

### 6. `/opt/pamir/.env` changes ownership on the first deploy

`mv .env.next .env` at `deploy.yml:150` replaces the file with a **new** file owned by
`VPS_USER`, mode 600. The alarm cron reads that same file: `deploy/check-alertas.sh:13` does
`source <(grep -E '^CRON_SECRET=' /opt/pamir/.env)`.

If the crontab runs as a different, non-root account than `VPS_USER`, the alarm cron breaks
**silently** after the first otherwise-successful deploy — and the cron is documented as
"CRÍTICO de seguridad". Verify which account owns the crontab before approving, and check
`/opt/pamir/cron.log` after.

### 7. `riala.cl` stops working the moment the new frontend image goes live

That is the intended effect of the new `default_server` blocks at
`frontend/nginx/default.conf:11-30`, and the plan calls it out. But it is a visible external
change: `https://riala.cl` will show a Cloudflare TLS error rather than the Pamir SPA until
its DNS is repointed or RIALA is deployed. Expect it rather than diagnose it.

Related open item the spec already flags (spec:197): `https://riala.cl` currently returns 200
even though the origin certificate covers only `*.andinoclubpamir.app` and
`andinoclubpamir.app` — which is only possible if the `riala.cl` Cloudflare zone is not set to
Full (strict). Worth fixing in the Cloudflare panel independently of this branch.

### 8. Spot-check HTTP/2 after the rollout

The new block at `frontend/nginx/default.conf:27-30` becomes the **default server** for port
443 — a role previously held by the named block that carries `http2 on` at `:48`. nginx
resolves the `http2` directive per virtual server after SNI, so this should be unaffected, but
the socket's default server did change and the check costs one command:

```bash
curl -I --http2 https://andinoclubpamir.app/
```

Look for `HTTP/2 200` rather than `HTTP/1.1 200`.

### 9. A failed migration blocks every later deploy

Prisma marks a partially applied migration as failed and refuses to proceed until it is
resolved by hand on the database (`prisma migrate resolve`). There is no automatic rollback —
spec:172-175 is explicit that Prisma has no down-migration path here and a reverted schema
change needs a new forward migration.

Note also the intermediate failure state: if `migrate deploy` at `deploy.yml:166` succeeds but
`docker compose up -d` at `:173` then fails, you are left with a **new schema serving old
containers**. The health check at `:177-188` will catch it (the job fails), but the fix is
manual.

### 10. Reject deployments you do not want — do not ignore them

An environment-gated job sits in `waiting` **while holding its concurrency group**. The
`deploy` job declares `concurrency: deploy-production` with `cancel-in-progress: false` at
`deploy.yml:113-115`, and GitHub only auto-fails an unactioned approval after **30 days**.

So an approval you simply leave alone blocks every subsequent deployment for up to a month.
(It does not block CI — that is precisely what scoping the group to the deploy job bought,
and the ruling was correct — but it does block deploys.) Click Reject on runs you do not want.
Rejecting is candidate-scoped and harmless; the next push queues a fresh approval.

### 11. Tighten the `production` environment while you are configuring it

- Set **Deployment branches** to `main` only. This is defence in depth behind the `images`
  job's `github.ref == 'refs/heads/main'` guard at `deploy.yml:58`: the guard stops the job
  from running, the environment restriction stops the environment from being used at all.
- Enable **Prevent self-review** if a second reviewer ever exists. On a single-owner repository
  it cannot be satisfied today, so leave it off for now — but revisit it the moment a
  collaborator is added.
- Move the four VPS secrets into this environment rather than repository scope — see I2.

### 12. What this review did not verify

I did not re-run the backend or frontend test suites, so the plan's recorded 607 backend and
182 frontend passing tests rest on the plan's own verification, not mine. I did run
`actionlint .github/workflows/deploy.yml` — clean, exit 0. Per the review constraints I made
no contact with the production VPS, so every VPS-side statement above is derived from the
committed files (`deploy/docker-compose.yml`, `deploy/check-alertas.sh`, `README.md`'s VPS
layout section) rather than from observation.
