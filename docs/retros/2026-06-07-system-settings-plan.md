# 2026-06-07 — System Settings 重構 + Tax Rate 設定 Plan

> **Stage:** Plan (David 揀咗 B 慢一慢 — 寫 plan doc 畀 David review 先)
> **Author:** Developer (main agent)
> **Status:** ⏸ Awaiting David approval
> **Branch:** 仲未開 — 喺 main 直接寫 plan doc, 實作時先 fork

---

## 1. 觸發原因

David 2026-06-07 觀察:
- 5 個 admin page(Users / Roles / AI 設定 / Man-day roles / Audit log)各自有 nav link,admin 操作要跳來跳去
- Settings page 嘅 Tax rate tab 係 `disabled cursor-not-allowed`(Phase 2 TODO)
- 期望:集中去「系統設置」一個 hub 搞晒所有 admin 嘢,加 Tax rate 設定

## 2. Plan questions resolved (David 揀咗)

| Question | Option | Detail |
|----------|--------|--------|
| 點樣收埋 admin pages 入 系統設置 | **A) Tabs (sub-routes)** | `/settings/pipeline`, `/settings/users`, etc. Deep link 仍 work。 |
| Tax rate 點同 quotation 互動 | **A) 預設值 (per-quotation 可覆寫)** | Quotation builder 用系統預設, sales 可逐張 override。Historical 唔變。 |
| Tax rate 跨區域定 per-region | **A) 全公司單一稅率** | 起步 1 個 row, 將來 per-region 簡單加。 |

## 3. Sub-route 結構

| URL | Component 來源 | Phase | 備註 |
|-----|---------------|-------|------|
| `/settings` | redirect → `/settings/pipeline` | — | 現有 default |
| `/settings/pipeline` | 現有 `settings.tsx` (Phase 1) | ✅ Done | Day 11 已 ship |
| `/settings/tax` | **新寫** `settings-tax.tsx` | 🆕 | 見 §4 |
| `/settings/users` | wrap 現有 `users.tsx` | 🔀 搬 | 頁面內容不變, 只外面包 SettingsLayout |
| `/settings/roles` | wrap 現有 `roles.tsx` | 🔀 搬 | 同上 |
| `/settings/ai` | wrap 現有 `ai-config.tsx` | 🔀 搬 | 同上 |
| `/settings/man-day` | wrap 現有 `man-day-roles.tsx` | 🔀 搬 | 同上 |
| `/settings/audit` | wrap 現有 `audit.tsx` | 🔀 搬 | 同上 |

## 4. Tax Rate 設計

### DB schema
```prisma
model SystemConfig {
  key         String   @id
  value       Json     // JSON-encoded value
  description String?
  updatedAt   DateTime @updatedAt
  updatedById String?
  updatedBy   User?    @relation(fields: [updatedById], references: [id], onDelete: SetNull)

  @@map("system_config")
}
```

通用 key-value table 起步(`default_tax_rate` 一個 row,將來仲有 `default_currency` / `default_pipeline` 等)。

### Seed
```ts
await prisma.systemConfig.upsert({
  where: { key: 'default_tax_rate' },
  update: {},
  create: {
    key: 'default_tax_rate',
    value: 0,        // 0% default,admin 喺 Settings 改
    description: 'Default tax rate (%) applied to new quotations; per-quotation override available.',
  },
});
```

### Backend endpoint
- `GET /api/settings/tax` → `{ rate: 5.00, updatedAt, updatedByName }`
- `PUT /api/settings/tax` body `{ rate: 5.00 }` → 200 + audit `SYSTEM_CONFIG_UPDATED` with metadata `{key, oldValue, newValue}`

### Frontend wiring (quotation-builder.tsx)
```ts
// 現有 (line 136):
const [taxRate, setTaxRate] = useState<number>(existing ? Number(existing.taxRate) : 0);

// 新:
const { data: taxConfig } = useQuery({
  queryKey: ['settings', 'tax'],
  queryFn: () => settingsApi.getTax(),
});
const [taxRate, setTaxRate] = useState<number>(
  existing ? Number(existing.taxRate) : Number(taxConfig?.rate ?? 0)
);
// existing 有就用 existing,否則 fallback 系統預設
```

### Audit
- `SYSTEM_CONFIG_UPDATED` action 加落 `AuditAction` enum
- 對齊 ADR-0014 retention: **12mo 普通 retention**(rate 唔係 sensitive, 唔使 24mo)
- 舊 quotation 嘅 taxRate column 保留, **唔做 data migration**(David 揀 A)

## 5. RBAC 影響

| Permission key | 用途 | Status |
|----------------|------|--------|
| `settings:read` | 讀 SystemConfig | 🆕 新加 |
| `settings:update` | 改 SystemConfig (PUT /settings/tax) | 🆕 新加 |
| `user:read` / `user:update` | 用戶管理 | ✅ 已有(唔變) |
| `role:read` / `role:update` | 角色管理 | ✅ 已有 |
| `ai-config:read` / `ai-config:update` | AI 設定 | ✅ 已有 |
| `man-day-role:read` / `man-day-role:update` | Man-day roles | ✅ 已有 |
| `audit:read` | Audit log | ✅ 已有 |

`settings:update` 只派俾 ADMIN role。3 個 system role matrix:

| Role | settings:read | settings:update |
|------|---------------|-----------------|
| ADMIN | ✅ | ✅ |
| SALES | ❌ | ❌ |
| VIEWER | ❌ | ❌ |

(Sub-route 入面個自嘅 page 用返各自 permission, 例如 `/settings/users` 內部仍要 `user:update`)

## 6. Nav layout 改動

```diff
 const adminNavItems = [
-  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
-  { to: '/roles', label: 'Roles', icon: Shield, adminOnly: true },
-  { to: '/man-day-roles', label: 'Man-day Roles', icon: Briefcase, adminOnly: true },
+  { to: '/settings', label: '系統設置', icon: Settings, adminOnly: true, badge: '7' },
   { to: '/settings', label: '系統設置', icon: Settings, adminOnly: true },
-  { to: '/ai-config', label: 'AI 設定', icon: Sparkles, adminOnly: true },
-  { to: '/audit', label: 'Audit Log', icon: History, adminOnly: true },
 ];
```

`系統設置` click 落 `/settings/pipeline`,`badge: '7'` 提示有 7 個 tab。

### Backward compat
喺 `App.tsx` 加 `<Navigate>` 自動 redirect:
```tsx
<Route path="/users" element={<Navigate to="/settings/users" replace />} />
<Route path="/roles" element={<Navigate to="/settings/roles" replace />} />
<Route path="/man-day-roles" element={<Navigate to="/settings/man-day" replace />} />
<Route path="/ai-config" element={<Navigate to="/settings/ai" replace />} />
<Route path="/audit" element={<Navigate to="/settings/audit" replace />} />
```

Deep link / bookmark / browser back button 都 work。

## 7. SettingsLayout 設計

```tsx
// apps/web/src/pages/settings-layout.tsx (新)
export default function SettingsLayout() {
  return (
    <div>
      <header>
        <h1>系統設置</h1>
        <p>管理 sales pipeline 嘅 stage、quotation tax rate、user、role、AI、man-day roles 同 audit log</p>
      </header>
      <Tabs value={currentTab} onValueChange={navigate}>
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="tax">稅率</TabsTrigger>
          <TabsTrigger value="users">用戶</TabsTrigger>
          <TabsTrigger value="roles">角色</TabsTrigger>
          <TabsTrigger value="ai">AI 設定</TabsTrigger>
          <TabsTrigger value="man-day">Man-day roles</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
      </Tabs>
      <Outlet />  {/* React Router nested route content */}
    </div>
  );
}
```

每個 sub-route page(e.g. `settings-tax.tsx`)純 render 內容; tab UI 由 parent layout 負責。

## 8. 實作 steps(預 4-6 小時, 4-6 commits)

1. **DB migration**:`SystemConfig` model + seed `default_tax_rate=0`
2. **Backend**:`/settings/tax` GET/PUT endpoint + `SYSTEM_CONFIG_UPDATED` 加 `AuditAction` enum
3. **RBAC**:`settings:read` / `settings:update` 入 `permissions.ts` + seed `RolePermission` rows
4. **Frontend routes**:`App.tsx` 加 nested routes + 5 個 `<Navigate>` backward compat
5. **SettingsLayout**:`pages/settings-layout.tsx` 新寫 + tab nav
6. **Page wrappers**:5 個 existing pages 包 `<SettingsLayout>`(或者純改 route 配置)
7. **Tax Rate tab UI**:`pages/settings-tax.tsx` 新寫 + `settingsApi.getTax/putTax` 入 `lib/api.ts`
8. **Quotation builder**:`quotation-builder.tsx` 加 `useQuery(['settings', 'tax'])` 預填
9. **Nav layout**:`app-layout.tsx` 5 個 entry → 1 個 `系統設置` + badge
10. **Smoke** + **revert detection**

## 9. 影響範圍 (file 預估)

| Area | Files | Est lines |
|------|-------|-----------|
| DB schema + migration + seed | `schema.prisma` + 1 migration + `seed.ts` | +50 |
| Backend route | `apps/api/src/routes/settings.ts` | +60 |
| RBAC | `packages/shared/src/permissions.ts` + seed | +10 |
| Frontend routes + Navigate | `App.tsx` | -5 + 35 |
| SettingsLayout | `pages/settings-layout.tsx` (新) | +90 |
| Settings-tax page | `pages/settings-tax.tsx` (新) | +80 |
| Quotation builder wire | `components/quotation-builder.tsx` | +20 |
| Nav layout | `components/layout/app-layout.tsx` | -8 + 15 |
| API client | `lib/api.ts` | +15 |
| AuditAction enum | `schema.prisma` | +1 |
| Docs | `docs/PRD.md` + `docs/QA-TRACKER.md` + retro | +180 |
| **Total** | **~12 files** | **~+540 / -13** |

## 10. Ship gate 影響

- **紅線 11 ✅** 自動 satisfy (commit PRD + QA-TRACKER 一齊)
- **紅線 13** 唔 trigger (冇 bug fix, 純 feature)
- **紅線 16** 要加 1 個 integration smoke test(GET/PUT /settings/tax + quote 預填行為)
- **紅線 18** 唔 trigger (冇新 dep)

## 11. 唔做嘅嘢 (P1/P2 backlog)

- Settings RWD mobile deep optimization(P1)
- Settings breadcrumb + 「unsaved changes」提示(P2)
- Per-region tax rate 拆分(P2 - 將來加, schema 預留彈性)
- Settings landing page 嘅「最近修改」summary(P2)
- 將其他 system default 搬入 SystemConfig table(P2: default currency, default pipeline colour, default region)

## 12. 決策點 — David 確認

呢個 plan 接受?**3 個 direction 揀咗 A 全部**, 5 個 sub-route 搬遷策略 + Tax rate 預設值設計 + RBAC 新 permission — 全部 reasonable defaults。

如果 plan OK 我就:
1. 開新 branch `feat/system-settings-tabs-2026-06-07`
2. 攞返 David 嘅 stash(merge 後 conflict 機會低, 因為 stash 嘅係 deals.tsx/quotations.tsx 同 settings 完全唔 overlap)
3. 跟 §8 嘅 10 步 plan 行
4. 跑 smoke + 出 evidence
5. PR + merge

如果想改 plan, 講邊度(David 揀 A 之外, 或者有新方向)。
