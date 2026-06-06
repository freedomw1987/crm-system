# Operations

Day-to-day dev, deploy, migration, and troubleshooting recipes.

For high-level architecture, see [`architecture.md`](./architecture.md).
For the API surface, see [`api.md`](./api.md).

---

## Environment variables

All set in `.env` at the project root (copy `.env.example`). The
containerised stack reads them via `docker-compose.yml`'s
`environment:` block, which substitutes `${VAR}` from the host `.env`.

| Var                 | Default              | Notes                                                            |
| ------------------- | -------------------- | ---------------------------------------------------------------- |
| `POSTGRES_USER`     | `crm`                | DB user                                                          |
| `POSTGRES_PASSWORD` | `crm_dev_password`   | **Must change for prod**                                          |
| `POSTGRES_DB`       | `crm_system`         | DB name                                                          |
| `JWT_SECRET`        | dev default          | **Must be long random in prod** (`openssl rand -hex 64`)         |
| `OPENAI_API_KEY`    | *(empty)*            | Required for the AI agent to function                             |
| `OPENAI_MODEL`      | `gpt-4o-mini`        | Override to use `gpt-4o` etc.                                     |
| `API_PORT`          | `3001`               | Internal API port                                                 |
| `WEB_PORT`          | `80`                 | Host port for the `web` container                                 |
| `ADMINER_PORT`      | `8080`               | Host port for `adminer` (when profile enabled)                   |
| `SEED_DB`           | *(empty)*            | Set to `true` to run `prisma/seed.ts` on container start          |
| `SKIP_MIGRATE`      | *(empty)*            | Set to `1` to skip `prisma migrate deploy` on start              |
| `NODE_ENV`          | `production` (compose) | `development` if you use `bun run dev` outside Docker         |

---

## Local development

### Quick start (Docker, with seed)

```bash
git clone git@david-dev-env:freedomw1987/crm-system.git
cd crm-system
./scripts/docker-dev.sh --seed
# Open http://localhost
# Login: admin@crm.local / admin123  (or sales@crm.local / sales123)
```

### Hot-reload (no Docker for app)

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Install workspace deps
bun install

# 3. Migrate + seed
bun db:migrate
bun db:seed

# 4. Start API (terminal 1)
cd apps/api
bun --env-file=../../.env --watch src/index.ts

# 5. Start Web (terminal 2)
cd apps/web
bun run dev   # http://localhost:5173 — /api proxied to :3001
```

Top-level convenience:

```bash
bun run dev     # runs `dev` in every workspace (api + web in parallel)
bun run build   # typecheck + build all workspaces
```

### Helper scripts

| Script                       | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `scripts/docker-dev.sh`      | The main dev entry point                             |
| `scripts/docker-reset.sh`    | Wipe Postgres volume + restart                       |
| `scripts/backup.sh`          | Dump Postgres to a timestamped file                  |
| `scripts/restore.sh`         | Restore from a `backup.sh` dump                      |
| `scripts/backup-container.sh` | Run `backup.sh` from inside the `crm-postgres` container |

`./scripts/docker-dev.sh --help` shows all flags.

---

## Production-like deployment (local)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Differences from the dev compose:

- No `adminer` sidecar
- API container uses the prebuilt image (no bind mounts)
- Restart policy is `always` rather than `unless-stopped`
- Bind mounts (e.g. for live code) are removed

For real production (AWS / ECS / RDS), see the *Production on AWS*
section below.

---

## Database migrations

Migrations live in `packages/db/prisma/migrations/`. They are
timestamp-prefixed SQL files (e.g. `20260605014842_init`) applied in
lexical order by `prisma migrate deploy`.

### Adding a new migration

For a normal schema change (add column, add table, add enum):

```bash
cd packages/db
bunx prisma migrate dev --name <change_name>
```

This generates the SQL file **and** applies it to the dev DB.

For structural changes Prisma can't express (enum ↔ table, column
type switch, etc.), see the `prisma-migrate-private-rds` skill for
the manual-SQL recipe. We've needed it twice in this project:

- **Day 8:** `Region` enum → `Region` table (see the migration
  `day8_region_deal_kanban` for the SQL pattern)
- **Day 9:** `services.status` plain text → `ServiceStatus` enum
  (see `add_service_status_enum`)

### Applying migrations on a running container

The api container's `docker-entrypoint.sh` runs `prisma migrate
deploy` on every start. **The api container's `migrations/`
directory is baked into the image at build time — there is no host
volume mount for it.**

That means: if you add a new migration on the host, you need to
either (a) rebuild the image, or (b) `docker cp` the new migration
folder into the running container and restart it:

```bash
# Local dev — fastest loop:
docker cp packages/db/prisma/migrations/<ts>_<name> crm-api:/app/packages/db/prisma/migrations/
docker restart crm-api
# Check the logs:
docker logs --tail 50 crm-api
# Should see: "N migrations found ... No pending migrations to apply"
```

If the container's filesystem drifts from the host's migration
folder, `prisma migrate deploy` will throw **P3009** on the next
start. Always sync the container's `migrations/` with the host's
folder.

### Verifying migration status

```bash
cd packages/db
bunx prisma migrate status
```

`Database schema is up to date` = no pending. The host's `.env`
must point to a reachable database (the docker-compose Postgres
isn't reachable from the host unless you expose the port, which
we don't by default; use `docker exec crm-api bunx prisma migrate
status` instead).

### Seeding the database

```bash
cd packages/db
bunx prisma db seed
```

Or with the container: set `SEED_DB=true` in `.env` and restart the
api container. The entrypoint runs the seed if the flag is set.

The seed is **idempotent only in a destructive way** — it
`deleteMany`s all rows in dependency order before re-inserting. Don't
run it against a database with real data.

---

## Seeding users

`packages/db/prisma/seed.ts` creates:

- `admin@crm.local / admin123` — assigned to the `ADMIN` role
- `sales@crm.local / sales123` — assigned to the `SALES` role
- 3 sample companies, 5 sample contacts, 8 sample products
- 1 default pipeline with 6 stages, 3 sample deals
- 1 sample quotation

The seed is suitable for local dev only. Don't run it on prod.

---

## Production on AWS *(not yet built)*

The project currently ships local Docker only. The planned AWS
architecture (see the *Pending / known gaps* section in
[`PROGRESS.md`](./PROGRESS.md)):

- **Compute**: ECS Fargate behind an ALB
- **Database**: RDS Postgres (private subnet, single-AZ for dev,
  multi-AZ for prod)
- **Object storage**: S3 for product images and uploaded files
- **CDN**: CloudFront in front of the ALB for static assets
- **IaC**: CDK (TypeScript)
- **CI/CD**: GitHub Actions or CodePipeline

The migration recipe in `prisma-migrate-private-rds` is already
proven for the ECS run-task approach.

---

## Common operational tasks

### Reset the database

```bash
./scripts/docker-dev.sh --reset
```

This stops the stack, removes the `crm_pgdata` volume, and rebuilds
from scratch. **All data is lost.** Use the backup script first.

### Tail logs

```bash
./scripts/docker-dev.sh --logs
# Or for a single service:
docker logs -f crm-api
docker logs -f crm-web
docker logs -f crm-postgres
```

### Connect to the database

```bash
docker exec -it crm-postgres psql -U crm -d crm_system
```

Or use Adminer (opt-in):

```bash
./scripts/docker-dev.sh --adminer
# Open http://localhost:8080
# Server: postgres  |  User: crm  |  Password: crm_dev_password  |  Database: crm_system
```

### Backup the database

```bash
./scripts/backup.sh                       # writes ./backups/crm_<timestamp>.sql
./scripts/backup-container.sh             # run inside the container
```

### Restore from a backup

```bash
./scripts/restore.sh ./backups/crm_<timestamp>.sql
```

### Run a one-off Prisma command in the api container

```bash
docker exec -it crm-api sh
# Inside:
cd /app/packages/db
bunx prisma studio                 # GUI on :5555
bunx prisma migrate status
bunx prisma generate
```

---

## Troubleshooting

### "Cannot find module 'elysia/types'" (typecheck)

Already worked around via `--skipLibCheck` in the typecheck script
(see the Elysia 1.2 d.ts issue in [`PROGRESS.md`](./PROGRESS.md)).
Don't remove that flag without triaging the noise.

### "Elysia 1.2 + bun build" ReferenceError

Do **not** use `bun build --minify` against an Elysia 1.2 app — the
runtime code-gen (`compile?.()`) can be renamed by the minifier and
the resulting bundle crashes at startup. Build the API by
`bun run apps/api/src/index.ts` directly inside the runtime image
(the Dockerfile already does this — see `apps/api/Dockerfile`).

### "Mac arm64 Docker build" failures

The `oven/bun:1.2` base image is missing `libssl`; install
`openssl ca-certificates curl` in the Dockerfile (already done).
Vite 8 + rolldown's optional `@rolldown/binding-linux-arm64-gnu`
dependency doesn't install via npm on arm64; the frontend Dockerfile
deliberately does **not** `COPY package-lock.json` so the
container re-resolves with `--include=optional` instead of
freezing the broken lockfile.

### "prisma.service.create" throws `42704 type "ServiceStatus" does not exist`

You added a new typed enum to the schema but didn't add a migration.
See [Adding a new migration](#adding-a-new-migration) and the
`prisma-migrate-private-rds` skill for the recipe.

### `prisma migrate deploy` throws P3009 (drift)

The api container's `migrations/` folder is out of sync with the
DB. Either rebuild the api image, or `docker cp` the missing
migration folder into the container and restart. See
[Applying migrations on a running container](#applying-migrations-on-a-running-container).

### `request<T>` 502 from nginx (upstream errors)

Check `docker logs crm-api` for the underlying Elysia / Prisma
error. The most common causes:

- A `POST` body validation failure (e.g. wrong key name — see
  [`architecture.md` § 7](./architecture.md))
- An unknown Prisma field name (e.g. sending `isActive` to a model
  that only has `status`)
- A Prisma enum mismatch — same as the `42704` issue above

### JWT auth suddenly returning 401 everywhere

The most common cause is rotating `JWT_SECRET` while tokens are
still in flight. Either:

- Drain the api service before rotating, or
- Make `JWT_SECRET` match across `web` (Vite proxy doesn't need it)
  and `api` (does)

### "Cannot read properties of undefined (reading 'length')" on a list page

Almost always a Prisma field-name drift. The backend returns the
Prisma field name (camelCased) and the frontend type uses a
different name. Normalise at the API boundary
(`lib/api.ts`). See [`frontend.md` § "Known frontend gotchas"](./frontend.md)
for the recipe and the historical incidents.

### Bun missing a package or runtime error after a dep change

```bash
rm -rf node_modules bun.lockb .bun
bun install
```

If that doesn't help, nuke the docker build cache and rebuild:

```bash
docker compose build --no-cache api web
```

---

## Backup and restore (DB)

`scripts/backup.sh` runs `pg_dump` from inside the `crm-postgres`
container and copies the result to `./backups/`.

`scripts/restore.sh` reads a SQL file (typically one of the
`./backups/crm_*.sql` files) and pipes it into `psql` in the
container. **Restoring truncates existing data** — confirm you
mean to do this.

The backup is **not** encrypted. Don't commit it to git. The
intended use is "back up before a destructive op, restore if it
went wrong". For long-term off-site backups, ship the SQL file to
S3 or similar.
