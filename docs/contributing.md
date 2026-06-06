# Contributing

Workflows, conventions, and pitfalls for working on the CRM system.

For high-level architecture, see [`architecture.md`](./architecture.md).
For the API surface, see [`api.md`](./api.md).

---

## Repo conventions

- **Monorepo with Bun workspaces.** `bun install` at the root
  installs every workspace. Per-workspace commands work too.
- **TypeScript everywhere.** Strict-ish; the only intentional
  loosening is `// @ts-nocheck` at the top of the Elysia route files
  (workaround for the Elysia 1.2 d.ts noise — see
  [`PROGRESS.md`](./PROGRESS.md) Day 1).
- **Lint is `eslint src --ext .ts,.tsx`** in `apps/web`. There is
  no enforced lint on `apps/api` or the packages yet.
- **No formatter configured.** Match the existing style: 2-space
  indents, single quotes, trailing commas where present, semicolons
  yes, 100-char soft limit.

---

## Branch / commit workflow

We don't enforce a strict branching model yet. The convention is:

- One feature per branch
- Squash-merge to `main`
- Commit messages in the imperative mood ("add X", "fix Y", not
  "added X" or "fixes Y")
- Reference the day / phase in the message body if it helps (e.g.
  `Day 9 — fix 502 on POST /services`)

---

## Adding a new resource (full-stack)

This is the most common change. Walk through the layers in this
order so the wiring stays consistent.

### 1. Database (Prisma)

Edit `packages/db/prisma/schema.prisma`. Add a model, an enum, or
extend an existing model. Then:

```bash
cd packages/db
bunx prisma migrate dev --name <change_name>
```

This generates the SQL file **and** applies it to the dev DB. The
client is regenerated automatically. If the change is structural
(enum ↔ table, column type switch), see the
`prisma-migrate-private-rds` skill for the manual-SQL recipe.

> **If you add a typed enum** that mirrors a previously-text column,
> remember the `ServiceStatus` Day 9 lesson: the new column type
> must be `CREATE TYPE`d in a migration, and the existing column
> must be `ALTER COLUMN ... TYPE "EnumName" USING col::"EnumName"`.

### 2. Backend route

Create `apps/api/src/routes/<resource>.ts`. Match the existing
pattern:

```ts
import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { requirePermission } from '../middleware/rbac';

export const resourceRoutes = new Elysia({ prefix: '/<resource>', tags: ['<resource>'] })
  .use(authContext)
  .use(requirePermission('<resource>:read'))   // gates the whole group

  .get('/', async ({ query }) => { /* list */ })
  .get('/:id', async ({ params, set }) => { /* detail */ })
  .post('/', async ({ body, set, userId, request }) => {
    // create
    await logEvent({ actorId: userId, action: '<RESOURCE>_CREATED', resourceType: '<resource>', resourceId: ..., request });
    set.status = 201;
    return created;
  }, {
    body: t.Object({ /* shape */ }),  // mandatory for POST/PATCH (Elysia schema)
  })
  .patch('/:id', async ({ params, body, set, userId, request }) => { /* ... */ })
  .delete('/:id', async ({ params, userId, request }) => { /* ... */ });
```

Wire it into `apps/api/src/index.ts`:

```ts
import { resourceRoutes } from './routes/<resource>';
// ...
  .use(resourceRoutes)
```

### 3. Permission key

If the new resource should be gated separately from existing
permissions, add the key to `PERMISSIONS` in
`packages/shared/src/permissions.ts` and assign it to the relevant
system roles in `ROLE_PERMISSIONS`. Then call
`requirePermission('<resource>:write')` on the write methods.

The Roles admin page picks up the new key on next load via
`GET /roles/permissions`.

### 4. Frontend API client

Add a per-resource namespace to `apps/web/src/lib/api.ts` (mirror
the existing `productsApi` / `servicesApi` shape):

```ts
export const resourcesApi = {
  list: (params: { ... } = {}) => request<{ items: Resource[]; total: number } | Resource[]>(`/<resource>${qs.toString() ? `?${qs}` : ''}`)
    .then((r) => Array.isArray(r) ? r : r.items),
  get: (id: string) => request<Resource>(`/<resource>/${id}`),
  create: (data: ResourceInput) => request<Resource>('/<resource>', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ResourceInput>) =>
    request<Resource>(`/<resource>/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/<resource>/${id}`, { method: 'DELETE' }),
};
```

If the response from the backend has a Prisma relation field that
the frontend type names differently, normalise at the boundary
(see [`frontend.md` § "Normalisation at the boundary"](./frontend.md)).

### 5. Frontend pages

Create `apps/web/src/pages/<resource>.tsx` and
`<resource>-detail.tsx` if needed. Use the existing pages as
templates — `services.tsx` is the most feature-rich (list with
filter, status badge, edit dialog, man-day editor, quick-create).

Wire the route in `apps/web/src/main.tsx`.

### 6. AI tool *(optional)*

If the agent should be able to query or mutate the new resource,
add a tool to `packages/ai/src/tools.ts` and document it in
[`ai-agent.md`](./ai-agent.md).

### 7. Documentation

- Add the resource to the index tables in
  [`api.md`](./api.md) and [`frontend.md`](./frontend.md).
- If the schema changed, update [`database.md`](./database.md)
  (new model section + new migration row in the history table).
- If you added a permission, update [`rbac.md`](./rbac.md).
- Add a Day 10 (or N+1) entry to [`PROGRESS.md`](./PROGRESS.md)
  summarising what shipped.

---

## Adding a new AI tool

1. Define a `Tool` literal in `packages/ai/src/tools.ts`. Specify
   `name`, `description` (this is what the model uses to pick the
   tool — be specific), `parameters` (JSON schema), and `execute`.
2. Push it into `toolRegistry`.
3. Document it in [`ai-agent.md`](./ai-agent.md).
4. (Optional) Add a smoke test by hitting `POST /chat/send` with a
   prompt that should trigger the new tool, then inspect the
   `toolCalls[]` in the response.

The system prompt in `prompts.ts` enumerates the tool names to the
model, so the new tool is immediately callable without further
prompt changes.

---

## Type safety around money

All money fields are Prisma `Decimal(12, 2)`, which Prisma
serialises to **JSON strings** on the wire. **Do not** sum two
`Decimal` fields with `+` — you will get string concatenation
(Day 6 bug). Coerce with `Number(...)` first.

```ts
// BAD
const total = a.total + b.total;          // "100.00" + "200.00" = "100.00200.00"

// GOOD
const total = Number(a.total) + Number(b.total);
```

For display, always go through `formatCurrency(amount, currency)`
from `lib/utils.ts`. The helper does the `Number(...)` coercion
internally.

---

## Common pitfalls (a checklist)

These have all bitten us. Read before changing anything in the
listed area.

### Backend (Elysia + Prisma)

- **Body validators on POST/PATCH.** Every mutating route should
  have a `t.Object({...})` schema validator. This catches shape
  mistakes at the boundary instead of letting Prisma throw on an
  unknown field. The 502 from `POST /services` on Day 9 was
  because the schema didn't have a validator — it would have caught
  the wrong `manDays` vs `manDayLines` key.

- **Wire-format keys on Prisma relations.** POST /services expects
  `manDayLines` in the body (the Prisma relation name). Always
  match the Prisma model field name on the wire, not the
  frontend-facing alias.

- **Include relations on list endpoints that display them.** If a
  list page renders nested data (e.g. service man-day count), the
  list endpoint must `include: { manDayLines: true }`. Day 9 fix.

- **Don't `prisma.service.findUnique` on the detail endpoint
  without the relation you render.** Day 9 service detail would
  have shown an empty man-day editor if the include had been
  missing — caught because the frontend type uses `manDays`
  (not the wire `manDayLines`) and the component would have
  crashed.

- **Don't trust the `User.role` enum column.** Read `User.roleId`
  and join to the `Role` table for the actual permission set. The
  enum is kept for back-compat only (Day 7).

- **The ai container is internal-only.** No host port. All traffic
  flows through `crm-web` (nginx).

### Frontend (React + Vite)

- **Don't bypass `lib/api.ts` with raw `fetch`.** Use the typed
  client so the `normaliseService()` boundary stays consistent
  (Day 9 lesson).

- **`bg-popover` is a custom token.** If a future Tailwind upgrade
  removes it, dropdowns go transparent. The defensive `bg-white
  border border-border` in `quotation-builder.tsx` is a fallback.

- **Prisma `Decimal` is a string.** Coerce with `Number(...)`
  before arithmetic (see "Type safety around money" above).

- **Drag-and-drop + click conflict on Deal cards.** Don't remove
  the `dragging` state guard.

- **All user-facing labels in 繁體中文香港口語.** The product is
  for HK sales teams.

- **The `/api` prefix is nginx-side.** When calling from the
  browser, use `/api/products`; the nginx config strips `/api` and
  forwards the rest to Elysia.

### Database (Prisma)

- **Migrations are timestamp-prefixed and applied lexically.** A
  manual migration's timestamp must be later than the most recent
  `prisma migrate dev`-generated one (see the
  `prisma-migrate-private-rds` skill).

- **The api container's `migrations/` is baked into the image.**
  If you add a migration on the host, `docker cp` it into the
  container and restart, or rebuild the image. Otherwise
  `migrate deploy` throws P3009.

- **The seed script is destructive.** It `deleteMany`s everything
  before re-inserting. Don't run it on a database with real data.

- **Don't change enums in `schema.prisma` without a manual
  migration.** `prisma migrate dev` cannot produce the SQL for
  enum ↔ table switches. See the `prisma-migrate-private-rds`
  skill for the recipe.

---

## Verifying your change

### Before opening a PR

- [ ] `bun run typecheck` at the root — exit 0
- [ ] `bun run build` at the root — succeeds
- [ ] Manually exercised the new path in the browser
- [ ] If the schema changed, a migration file is in
      `packages/db/prisma/migrations/` and the dev DB is updated
- [ ] If a new permission was added, the system roles cover it
- [ ] If the API surface changed, [`api.md`](./api.md) is updated
- [ ] If a new AI tool was added, [`ai-agent.md`](./ai-agent.md) is
      updated
- [ ] If a new page / component was added,
      [`frontend.md`](./frontend.md) is updated
- [ ] A `PROGRESS.md` entry has been added for the day

### Smoke-test patterns

For the API (avoids Hermes secret-redaction interfering):

```bash
# Inside the container (Node smoke test — Prisma direct)
docker cp /tmp/smoke.js crm-api:/app/smoke.js
docker exec crm-api node /app/smoke.js
docker exec crm-api rm /app/smoke.js
```

For the UI (avoids the JWT redaction issue with shell-based curl):

- Log in via the browser, exercise the path, watch the network tab
- Or use the dev tools' "copy as fetch" to grab a fully-authed
  request you can replay from the console
