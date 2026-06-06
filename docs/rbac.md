# RBAC (Role-Based Access Control)

Source of truth: `packages/shared/src/permissions.ts` (the
`PERMISSIONS` map, the three system roles, and the `can()` helper).

The DB-side `Role` and `RolePermission` tables (see
[`database.md`](./database.md)) hold the runtime state for custom
roles. The system roles (`ADMIN`, `SALES`, `VIEWER`) are seeded from
this file on first migration.

---

## Permission keys

Permissions are keyed `<resource>:<action>` where the action is one
of `read` / `create` / `update` / `delete` / `send` (or `use` for the
chat permission, or no suffix for some one-off actions).

| Permission         | Description                          | Used by routes                                       |
| ------------------ | ------------------------------------ | ---------------------------------------------------- |
| `user:read`        | View user list and details           | `GET /users`, `GET /users/:id`                        |
| `user:create`      | Create new user accounts             | `POST /users`                                         |
| `user:update`      | Edit user name, role, or active status | `PATCH /users/:id`                                  |
| `user:delete`      | Delete user accounts                 | `DELETE /users/:id`                                   |
| `audit:read`       | View audit log                       | `GET /audit`                                          |
| `company:read`     | View companies                       | `GET /companies*`                                     |
| `company:create`   | Create companies                     | `POST /companies`                                     |
| `company:update`   | Edit companies                       | `PATCH /companies/:id`                                |
| `company:delete`   | Delete companies                     | `DELETE /companies/:id`                               |
| `contact:read`     | View contacts                        | `GET /contacts*`                                      |
| `contact:create`   | Create contacts                      | `POST /contacts`                                      |
| `contact:update`   | Edit contacts                        | `PATCH /contacts/:id`                                 |
| `contact:delete`   | Delete contacts                      | `DELETE /contacts/:id`                                |
| `product:read`     | View products                        | `GET /products*`                                      |
| `product:create`   | Create products                      | `POST /products`                                      |
| `product:update`   | Edit products                        | `PATCH /products/:id`                                 |
| `product:delete`   | Delete products                      | `DELETE /products/:id`                                |
| `quotation:read`   | View quotations                      | `GET /quotations*`                                    |
| `quotation:create` | Create quotations                    | `POST /quotations`                                    |
| `quotation:update` | Edit quotations                      | `PATCH /quotations/:id`, item CRUD                    |
| `quotation:delete` | Delete quotations                    | `DELETE /quotations/:id`                              |
| `quotation:send`   | Send a quotation (DRAFT → SENT)      | `POST /quotations/:id/status`                          |
| `deal:read`        | View deals                           | `GET /deals*`                                         |
| `deal:create`      | Create deals                         | `POST /deals`                                         |
| `deal:update`      | Edit deals                           | `PATCH /deals/:id`, `PATCH /deals/:id/stage`           |
| `deal:delete`      | Delete deals                         | `DELETE /deals/:id`                                   |
| `chat:use`         | Use the AI assistant                 | `POST /chat/send`, `GET/DELETE /chat/conversations*`  |

> The `region` and `service` resources don't have explicit permission
> keys — they're gated by `user:read` (regions) and the
> `quotation:read` permission (services, in practice — see the
> `requirePermission` calls in the route files for the actual keys
> enforced today). If you add a dedicated service write API, add
> `service:read|create|update|delete` keys.

---

## System roles

| Role      | Description                          | Permission set                                                                      |
| --------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `ADMIN`   | Full access + user/role/audit mgmt  | All permissions listed above                                                        |
| `SALES`   | Day-to-day CRM work                  | `company:*`, `contact:*`, `product:read`, `quotation:*` (incl. `quotation:send`), `deal:*`, `chat:use` |
| `VIEWER`  | Read-only                            | `company:read`, `contact:read`, `product:read`, `quotation:read`, `deal:read`         |

System roles are seeded with `isSystem: true`, which the `Role`
admin UI respects — the row cannot be deleted and its `name` cannot
be renamed. Custom roles (`isSystem: false`) can be freely created,
edited, and deleted by an ADMIN.

---

## Enforcement

### Backend

Every route group in `apps/api/src/routes/*.ts` calls
`requirePermission('resource:action')` as a `.use(...)` middleware
**at the route group level**, so every method on the group is
gated:

```ts
// apps/api/src/routes/quotation.ts
export const quotationRoutes = new Elysia({ prefix: '/quotations', tags: ['quotations'] })
  .use(authContext)
  .use(requirePermission('quotation:read'))   // <— gates everything below
  .get('/', …)
  .get('/:id', …)
  .post('/', …, { body: t.Object({...}) })   // Elysia schema validator
  .patch('/:id', …)
  .delete('/:id', …);
```

The `requirePermission` middleware reads `ctx.userId`, looks up the
`Role` from the JWT (or, for a future optimisation, from the DB
relationship), and either continues or returns `403`. The middleware
factory is in `apps/api/src/middleware/rbac.ts`.

Some routes need a stronger permission for a specific method
(e.g. `POST /quotations/:id/status` requires `quotation:send` on
top of `quotation:read`). For those, the method handler calls
`requirePermission(...)` itself in addition to the group-level
middleware.

### Frontend

The web app does **not** enforce permissions locally. The UI is
allowed to show buttons and links to actions the user can't perform;
the backend returns 403 if they try, and the mutation's `onError`
shows a toast.

This is intentional — it keeps the frontend permission code out of
sync with the backend, and lets us add a new permission without
needing to update both sides.

The `/roles` admin page is the exception: it shows the role's
permission matrix, sourced from `GET /roles/permissions` and
`GET /roles/matrix`.

---

## Adding a new permission

1. Add the key + description to `PERMISSIONS` in
   `packages/shared/src/permissions.ts`.
2. Add the key to the appropriate system role's set in
   `ROLE_PERMISSIONS` in the same file.
3. Apply `requirePermission('new:key')` to the route group or
   specific method.
4. (Optional) If the new permission should be assignable to custom
   roles, no DB migration is needed — `RolePermission.permission` is
   a free-form string column. The UI will pick it up on next load
   via `GET /roles/permissions`.
5. Document the new permission in this file.

---

## Custom roles in practice

Custom roles (e.g. "Senior Sales", "Marketing Read-Only") are
created in the `/roles` admin page. The form posts to `POST /roles`
with a `permissions: string[]` array; the API validates that every
permission in the array is a known key (in practice, today, it's a
free-form string column and the UI is the source of truth).

A typical setup:

- `ADMIN` — system role, full access
- `SALES` — system role, the day-to-day rep
- `VIEWER` — system role, read-only
- `Senior Sales` — custom role, SALES permissions plus `user:read`
- `Marketing` — custom role, read-only on companies + contacts
  (e.g. for an integrated marketing team to scrub the DB)

---

## Seed

The seed script (`packages/db/prisma/seed.ts`) creates the three
system roles and assigns the default ADMIN user to the `ADMIN` role.
The `SALES` user is also assigned to the `SALES` role.

If you add a new system role, update the seed to insert it with
`isSystem: true` and the corresponding `RolePermission` rows.
