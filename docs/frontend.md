# Frontend

Vite + React 19 + Tailwind 3 + react-query + react-router-dom v7.

Source tree:

```
apps/web/src/
├── main.tsx
├── index.css                        # tailwind directives + thin utilities
├── pages/                           # one file per route
├── components/
│   ├── layout/app-layout.tsx        # nav + auth gate
│   ├── ui/                          # design-system primitives
│   ├── require-auth.tsx             # route guard
│   ├── quotation-builder.tsx        # polymorphic line-item editor
│   ├── product-dialog.tsx           # shared product create/edit
│   └── quick-create-service-dialog.tsx
└── lib/
    ├── api.ts                       # typed request<T> client + per-resource APIs
    └── utils.ts                     # formatCurrency, … (token helpers live in api.ts)
```

---

## Pages (routes)

| Route                          | File                          | Purpose                                          |
| ------------------------------ | ----------------------------- | ------------------------------------------------ |
| `/login`                       | `pages/login.tsx`             | Email/password login                             |
| `/dashboard`                   | `pages/dashboard.tsx`         | KPI cards + recent activity                      |
| `/companies`                   | `pages/companies.tsx`         | List + filter (region, status)                   |
| `/companies/:id`               | `pages/company-detail.tsx`    | Detail + linked contacts/quotations/deals        |
| `/products`                    | `pages/products.tsx`          | Catalogue + inventory                            |
| `/services`                    | `pages/services.tsx`          | Service catalogue + SOW + man-day breakdown      |
| `/services/:id`                | `pages/service-detail.tsx`    | Edit service + manage man-day rows               |
| `/quotations`                  | `pages/quotations.tsx`        | List of all quotations                           |
| `/quotations/:id`              | `pages/quotation-detail.tsx`  | View + status workflow                           |
| `/quotations/new`              | (uses `QuotationBuilder`)     | Polymorphic line-item editor (create mode)       |
| `/deals`                       | `pages/deals.tsx`             | Kanban board with drag-and-drop                  |
| `/users`                       | `pages/users.tsx`             | User management (admin)                          |
| `/users/:id`                   | `pages/user-detail.tsx`       | Edit user + role                                 |
| `/roles`                       | `pages/roles.tsx`             | RBAC role + permission matrix (admin)            |
| `/ai-chat`                     | `pages/ai-chat.tsx`           | AI assistant UI                                  |
| `/audit`                       | `pages/audit.tsx`             | Audit log viewer (admin)                         |

---

## State management

- **Server state** — `react-query` (`@tanstack/react-query`). All API
  reads are wrapped in `useQuery`, all writes in `useMutation`. The
  client throws `ApiError` on non-2xx; the UI can use `mutation.error`
  to display messages.
- **Local form state** — `useState`. No global form library.
- **Auth token** — `localStorage` key `crm:token`. Read on every
  request by `lib/api.ts`.
- **No Redux / Zustand** — even though `zustand` is in `package.json`,
  nothing in the app currently uses it.

---

## The `lib/api.ts` client

All HTTP calls flow through a single typed client. There is no
`fetch` in any page or component.

```ts
import { productsApi, servicesApi, ... } from '@/lib/api';

const list = await productsApi.list({ category: 'Hardware' });
const svc  = await servicesApi.get(id);   // normalised manDays field
const q    = await quotationsApi.create(payload);
```

The client:

- Attaches the JWT from `localStorage` to every request as
  `Authorization: Bearer *** throws `ApiError` (with `status` and
  `body`) on non-2xx so callers can branch on `e.status`.
- Returns a raw `Promise<T>` (no auto-retry).
- Has per-resource helpers, e.g. `quotationsApi.addItem(qid, payload)`
  for nested endpoints that don't fit the standard
  `get/list/create/update/remove` shape.

### Per-resource namespaces

Each `routes/*.ts` route group in the backend has a matching
namespace in the client (e.g. `servicesApi` mirrors `serviceRoutes`).
The mapping is one-to-one so the API reference in [`api.md`](./api.md)
is the same shape as the client API.

### Normalisation at the boundary

`lib/api.ts` has a `normaliseService()` helper that copies
`manDayLines` (the wire field name from Prisma) onto `manDays` (the
frontend type). This is called from every `servicesApi.{list,get,
create,update}`. The rest of the frontend can use `manDays`
exclusively.

If you add a new endpoint that returns a Prisma relation under a
camelCase key that the frontend type names differently, follow the
same pattern.

---

## Components

### `components/ui/`

A thin design-system layer of primitives. Each file is small (~50–150
lines) and follows the same shadcn-style API. Tailwind tokens
(`bg-card`, `text-muted-foreground`, etc.) are defined in
`tailwind.config.js`.

| File               | Exports                                                |
| ------------------ | ------------------------------------------------------ |
| `button.tsx`       | `Button` with `variant` and `size` props                |
| `card.tsx`         | `Card`, `CardHeader`, `CardTitle`, `CardContent`        |
| `dialog.tsx`       | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` |
| `input.tsx`        | `Input`, `Textarea`                                    |
| `select.tsx`       | `Select`, `Label`                                      |
| `badge.tsx`        | `Badge` with `variant` (`success`, `destructive`, `secondary`, `warning`, `outline`) |

> **Note on `bg-popover`.** This token was added in Day 9 to fix
> site-wide dropdown transparency; without it, `bg-popover` was a
> missing class and the dropdown panels were see-through.

### `components/layout/app-layout.tsx`

Renders the top nav and the `<Outlet>` for nested routes. Wraps the
whole app once at the route tree root.

### `components/require-auth.tsx`

Route guard. Redirects to `/login` if no token in `localStorage`.

### `components/quotation-builder.tsx`

The polymorphic line-item editor used by both the create-page flow
and the deal-detail flow. Key features:

- Per-line `PRODUCT | SERVICE` toggle
- Product / service autocomplete (with inline quick-create dialogs
  that reuse the shared `product-dialog.tsx` and
  `quick-create-service-dialog.tsx`)
- Live `subtotal` / `taxAmount` / `total` recompute
- Service items render an SOW preview (collapsed by default) from
  the `manDaySnapshot`
- Edit mode re-syncs items against the server, computes a diff
  (add / update / delete) and applies it in one round-trip

### `components/product-dialog.tsx`

Shared Product create + edit dialog. Extracted from the original
`pages/products.tsx` so the quotation builder's inline quick-create
uses the same full form. Props:

```ts
{ product?: Product; open: boolean; onOpenChange: (v: boolean) => void;
  defaultName?: string; onSaved?: (p: Product) => void; }
```

### `components/quick-create-service-dialog.tsx`

Shared Service create dialog. Used by:
- The Quotation Builder autocomplete (`ProductAutocomplete` /
  `ServiceAutocomplete`)
- The Services page "新增服務" button (replaces the old local dialog)

Returns the normalised Service (with `manDays` field) to the caller
via `onCreated`.

---

## Routing

`react-router-dom` v7. The route tree is defined in `main.tsx`.
Public routes (`/login`) sit outside the auth guard; everything
else is wrapped in `RequireAuth`.

```
/login                              ← public
/(auth required)
  /dashboard
  /companies
  /companies/:id
  /products
  /services
  /services/:id
  /quotations
  /quotations/:id
  /quotations/new
  /deals
  /users
  /users/:id
  /roles
  /ai-chat
  /audit
```

Unknown paths render a 404 page (provided by `react-router`).

---

## Conventions

- **All user-facing labels in 繁體中文香港口語.** The product is
  aimed at HK sales teams; technical identifiers stay in English.
- **Money is rendered via `formatCurrency(amount, currency)` from
  `lib/utils.ts`.** Coerce Prisma `Decimal` strings with `Number(…)`
  before passing them in.
- **No `any` types.** Use the shared types from `@crm/shared` and
  the per-resource types from `lib/api.ts`.
- **Defensive reads on optional fields.** Use `?? 0` / `?? []` on
  fields that the API might omit (`manDays`, `description`,
  `costPrice`, etc.).
- **Tailwind class strings are template literals**; no `clsx` /
  `cva` at the call site (the project does include `clsx` in
  `package.json` for future use).

---

## Known frontend gotchas

These have all bitten us at least once. They're recorded so the
fix doesn't regress.

1. **Wire-format key on Service man-day payload** — `POST/PATCH
   /services` must use `manDayLines` (the Prisma relation name) in
   the JSON body, not `manDays` (the frontend type). The Elysia
   validator rejects unknown keys with a 502. The `servicesApi`
   wrapper handles this — but if you write raw `fetch` instead,
   you'll be sorry. See [`architecture.md` § 7.3](./architecture.md).

2. **Field-name drift** — the backend returns `manDayLines` (the
   Prisma field) while the frontend `Service` type uses `manDays`.
   `lib/api.ts` has a `normaliseService()` helper at the boundary.
   If you bypass `servicesApi` and read the response directly,
   `service.manDays` will be `undefined` and `s.manDays.length`
   will throw.

3. **List-endpoint shape** — some list endpoints return a bare
   array, others `{ items, total }`. The client normalises both.
   Components never have to think about it.

4. **`bg-popover` was a no-op class** until Day 9 added the
   `popover` token to `tailwind.config.js`. If a future Tailwind
   upgrade removes the custom token, dropdowns go transparent
   again. There's a `bg-white border border-border` fallback in
   `quotation-builder.tsx` line ~753 for defence-in-depth.

5. **Prisma `Decimal` is a string on the wire.** Summing two
   Prisma-money fields with `+` concatenates. Always `Number(…)`
   first. (Caught Day 6.)

6. **Drag-and-drop + click conflict on Deal cards.** `DealCard`
   has a `dragging` state guarded with a 1-frame `onDragEnd` so
   that a click after a drag doesn't accidentally open the edit
   dialog. Don't remove the guard.

7. **Service `manDayLines` was silently dropped on PATCH** before
   Day 9 because the PATCH route had no body validator and the
   frontend was sending `manDays`. If you write a new write
   endpoint, either use the existing `servicesApi.update` (which
   sends the right key) or pass the wire key explicitly. Do not
   typecast and assume Prisma will accept any field.

8. **Elysia 1.2 d.ts noise** is filtered out by `--skipLibCheck`
   in the typecheck script. Don't remove that flag without
   triaging the noise first.

9. **`request<T>` in `lib/api.ts` is a pure typecast.** It does
   not normalise field names. Any backend relation field that
   doesn't match the frontend's camelCase expectation must be
   normalised at the API boundary — see
   [`architecture.md` § 7.2](./architecture.md).

10. **TypeScript-only `as` casts at component boundaries** are
    allowed for narrow type-narrowing (e.g. `<select>` `onChange`).
    Avoid `as any`.
