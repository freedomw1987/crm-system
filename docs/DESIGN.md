# CRM System — Design Document

> Design tokens, UI patterns, and component conventions for the CRM frontend.
> Source of truth is the code (`apps/web/src/components/ui/`) — this document
> explains *why* the conventions exist and when to deviate.

---

## 1. Visual language

| Aspect | Choice | Reasoning |
|--------|--------|-----------|
| Font | System UI stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `PingFang TC`) | Fast load, native feel on each OS, no web font FOUT |
| Primary colour | Brand blue (custom Tailwind `primary` token) | Reads as trustworthy/professional |
| Bilingual | 繁中 primary, English secondary | David + HK market; nav labels are English (per Day 10 spec) |
| Density | Compact by default (Tailwind `text-sm` for body) | More data per screen for sales reps |
| Borders | 1px solid `border` token | Subtle separation, no heavy boxes |
| Shadows | `shadow-sm` for cards, `shadow-lg` for FAB + modals | Modals need to float over content |
| Spacing | 4 / 8 / 16 / 24 px scale (Tailwind default) | Don't reinvent — designers + devs share the same scale |

## 2. Layout

### 2.1 Global chrome (`AppLayout`)

```
┌────────────┬──────────────────────────────────────┐
│  Sidebar   │  <header> (mobile only)              │
│  (240 px)  ├──────────────────────────────────────┤
│            │                                      │
│  Logo      │                                      │
│  Nav links │            <main> (Outlet)           │
│  …         │                                      │
│  ───       │                                      │
│  User      │                                      │
│  Logout    │                                      │
│            │                                      │
└────────────┴──────────────────────────────────────┘
                                              ┌─────┐
                                              │ FAB │  (AiFab, fixed)
                                              └─────┘
```

- **Sidebar**: fixed left, full height. On `< lg` it's `-translate-x-full` and
  toggled by the hamburger button.
- **Header**: only renders on `< lg` (mobile).
- **Main**: scrolls independently (`overflow-auto`). Renders `<Outlet />`.
- **FAB**: `position: fixed`, `bottom-6 right-6`, `z-50`. Sits *above* main
  but *below* modals (which use `z-[100]+`).

### 2.2 Page patterns

#### Detail page pattern (e.g. `/companies/:id`)

```
┌──────────────────────────────────────────┐
│  ← Back    [Title]    [Edit] [Delete]    │  Header
├──────────────────────────────────────────┤
│  [Tab 1]  [Tab 2]  [Tab 3]               │  Tab nav
├──────────────────────────────────────────┤
│                                          │
│  Active tab content                      │
│                                          │
└──────────────────────────────────────────┘
```

Tabs are kept in-page with `useState` (no router sub-routes) when they don't
need deep-linking. Each tab content is a separate sub-component file
(`OverviewTab.tsx`, `ActivityTab.tsx`, `AttachmentsTab.tsx`).

#### List page pattern (e.g. `/companies`)

```
┌──────────────────────────────────────────┐
│  Title                [Search] [+ New]   │
│  Subtitle / count                        │
├──────────────────────────────────────────┤
│  Card  Card  Card    (grid 1/2/3 cols)   │
│  Card  Card  Card                        │
│  Empty state if 0                        │
└──────────────────────────────────────────┘
```

## 3. Component library

`apps/web/src/components/ui/` — shadcn-style primitives (Button, Input,
Dialog, Card, Select, …). One file per component, no nested exports. All
accept `className` for tailwind overrides.

### 3.1 Naming

- PascalCase for components: `DealCard`, `QuotationBuilder`
- camelCase for hooks: `useAuth`, `useDealFilter`
- Lowercase for utils: `cn`, `formatDateTime`

### 3.2 Form pattern

- Field label always above the input (not floating)
- Required indicator: `*` after label text
- Validation error rendered below the field, red text, `text-sm`
- Submit button disabled while `isPending` from React Query
- On mutation error, show error toast + keep form open

### 3.3 Dialog pattern

- Uses shadcn `Dialog` primitive
- Title + close X in header
- Body has the form / content
- Footer has Cancel + primary action
- Primary action: button colour `primary`, label is verb ("Save", "Create",
  not "OK")
- ESC + clicking outside = cancel (default Dialog behaviour)
- Long forms scroll within dialog body, not the page

## 4. Day 10 — AI Assistant UI specifics

### 4.1 FAB (AiFab)

```
                                            ┌──────────┐
                                            │  [🪄]    │  ← pulse ring
                                            │  (56px)  │
                                            └──────────┘
                                            AI Assistant  ← label on hover
```

- 56 px circle (Material Design FAB spec)
- Brand-primary background, white icon
- Pulse ring (`animate-ping`) to draw the eye without being noisy
- Hover label slides in from the right
- `aria-label="開 AI Assistant"` for screen readers
- Hidden when `location.pathname === '/ai'` so it doesn't cover the chat

### 4.2 Chat page (`/ai`)

```
┌──────────────┬─────────────────────────────────────┐
│  [新對話]     │  Conversation title                  │
├──────────────┤─────────────────────────────────────┤
│  Conv 1      │                                      │
│  Conv 2      │  [User] Hi, what deals are open?     │
│  Conv 3      │  [Bot]  Let me check…                │
│              │        🔧 list_deals  ▾              │
│              │           {json}                     │
│              │  [Bot]  You have 5 open deals…       │
│              │                                      │
│              ├─────────────────────────────────────┤
│              │  [textarea]              [Send]      │
└──────────────┴─────────────────────────────────────┘
```

- 2-pane grid: `[260px_1fr]` on `md+`, single column on mobile
- Conversation list scrolls independently
- Message stream scrolls to bottom on new message
- Tool calls are collapsible (`<details>`-like with caret)
- Empty state shows 4 example prompts as clickable buttons
- Composer: textarea (2 rows), Enter to send, Shift+Enter for newline
- "AI 諗緊..." spinner during `sendMutation.isPending`
- Error banner (red) if mutation fails

## 5. AI Config page (`/admin/ai-config`)

```
┌──────────────────────────────────────────┐
│  AI Assistant 設定                        │
│  連接到外部 LLM provider (OpenAI-compat)  │
├──────────────────────────────────────────┤
│  Endpoint URL *                           │
│  [https://api.openai.com/v1           ]  │
│                                          │
│  API Key *                               │
│  [•••••••••••••••••••••••]   👁          │
│  Never pre-filled. Re-enter on every save │
│                                          │
│  Model name *                            │
│  [gpt-4o                              ]  │
│                                          │
│  System prompt (optional)                │
│  [textarea, 6 rows                       │
│   override default CRM assistant prompt ] │
│                                          │
│  [Test connection]   [Save]              │
├──────────────────────────────────────────┤
│  Last updated: 2026-06-09 10:42 by Admin  │
│  Test result: ✅ 200 OK (gpt-4o, 14ms)   │
└──────────────────────────────────────────┘
```

- API key field is `type="password"` always, even when editing existing
  config (defence in depth against accidental paste into screenshots)
- Test button probes the LLM with a 1-token request, shows latency
- Save button requires all 3 required fields; system prompt is optional

## 6. Accessibility

- All interactive elements have visible focus rings
- `aria-label` on icon-only buttons
- Form fields have associated `<Label htmlFor>`
- Modals trap focus
- Color is never the only signal (errors include text + icon)

## 7. Internationalisation

- 繁中 primary for content
- English for nav labels (per David Day 10 spec: "Man day role", "Roles",
  "Users", "Audit Log", "AI 設定")
- All user-facing strings live in the component (no i18n framework yet —
  premature; we only support one locale)

## 8. Mobile-first RWD

- Tailwind breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280
- Mobile-first: design for 375 px width first, then add `md:` `lg:` variants
- Touch targets: minimum 44×44 px (iOS HIG)
- iOS Safari: avoid `100vh` for full-page layouts (use `100dvh` or `h-screen`
  with the viewport-fit hack — see `ios-safari-scroll-fixed-elements` skill)

## 9. Day 14.7 — System Settings sub-route tabs

### Architecture

The Settings surface is **one** URL prefix (`/settings/*`) with **seven**
sub-routes, each rendering inside a shared `<SettingsLayout />` chrome:

```
/settings             → <Navigate to=/settings/pipelines replace />
/settings/pipelines   → <SettingsPage />          (Day 11 Pipeline CRUD)
/settings/users       → <UsersPage />             (moved from top-level)
/settings/roles       → <RolesPage />             (moved from top-level)
/settings/ai          → <AiConfigPage />          (moved from top-level)
/settings/man-day     → <ManDayRolesPage />       (moved from top-level)
/settings/tax         → <SettingsTaxPage />       (new in Day 14.7)
/settings/audit       → <AuditPage />             (moved from top-level)
```

The Layout renders:

1. A heading (`<h1>系統設置</h1>`) + sub-title
2. A shadcn `<Tabs>` row with 7 `<TabsTrigger>` (Pipelines / Users / Roles /
   AI / Man-day / Tax / Audit)
3. An `<Outlet />` for the child route

### Why URL = source of truth (not Radix Tabs' internal state)

We use `<Tabs value={currentTab} onValueChange={handleTabChange}>` where
`currentTab` is derived from `useLocation().pathname` and `handleTabChange`
calls `navigate('/settings/<next>')`. This is **not** the standard shadcn
Tabs pattern (which uses `useState` internally), but it's deliberate:

- Deep links work: pasting `/settings/tax` into a chat or email lands on
  the Tax tab with the right content rendered
- Browser back/forward navigate between tabs as expected
- Each tab is independently URL-shareable
- The SettingsLayout can be in the URL contract (e.g. the Tax tab's "View
  audit log" link emits `/settings/audit?action=SYSTEM_CONFIG_UPDATED`)

### Why `TabsTrigger` + `onClick`, not `<NavLink>` inside `<TabsList>`

An early implementation used `<NavLink>` inside `<TabsList>` (styled to
look like `<TabsTrigger>`). It failed because Radix Tabs in controlled
mode logs a console warning when its `value` prop doesn't match a child
`<TabsTrigger value=…>`. We switched to native `<TabsTrigger>` + `onClick`
calling `navigate(...)`. Trade-off: middle-click "open in new tab" no
longer works on the tab strip (it's a `<button>`, not an `<a>`). Acceptable
because the tab nav is for in-app navigation; deep links from outside the
app still land on the right tab via the URL contract above.

### Why the sidebar collapsed from 5 admin links → 1

Before Day 14.7 the sidebar (ADMIN section) had 5 separate entries:
Users / Roles / Man day role / AI 設定 / Audit Log. After Day 14.7 there's
**one** entry: 系統設置 → `/settings`. The 7 tabs are the new surface
area; the sidebar is a single discoverable entry point.

The 5 top-level direct routes (`/users`, `/roles`, `/audit`, `/ai-config`,
`/man-day-roles`) are kept as `<Navigate replace />` redirects to the
new sub-routes, so any bookmark / chat-share / email link from before
today still works.

### Why the legacy `/settings` route redirects to `/settings/pipelines`

The original Day 11 /settings rendered `<SettingsPage />` directly with
its own button-style tab strip showing only "Pipeline" and a disabled
"Tax rate (Phase 2)" placeholder. When the new `<SettingsLayout />`
7-tab nav was added in Day 14.7 Step 6, the Layout's tabs only render
inside the layout — but `/settings` (the URL the original page lived at)
was being matched by the **direct route** first, bypassing the layout
entirely. We made `/settings` a `<Navigate replace />` to
`/settings/pipelines`, which is the Pipeline tab in the new layout. The
"Plan execution deviation" entry in the retro explains this in detail.

### Per-tab page chrome (header duplication)

Each `<Outlet />` child page renders its own `<h1>` (e.g. UsersPage has
"Users", AuditPage has "Audit Log"). The SettingsLayout's own `<h1>系統設置</h1>`
sits **above** the tab row, so the visual hierarchy is:

```
系統設置                          ← Layout h1
管理 sales pipeline、user、role…   ← Layout subtitle
[Pipelines | Users | | | Tax | ]  ← Tab row
                                    ← Outlet area:
Users                              ←   Child page h1
管理系統用戶帳號、角色同權限        ←   Child page subtitle
...                                ←   Child page content
```

This is intentional — the Layout h1 names the **section** (settings), and
the child page h1 names the **view** (users, audit, etc.). iOS Human
Interface Guidelines and Material Design both recommend this
section/view pattern in tabbed surfaces.
