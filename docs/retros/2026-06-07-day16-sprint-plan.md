# 2026-06-07 — Day 16 Sprint Plan

> **Stage:** Plan (David 揀咗 "B→A" 2026-06-07 — Day 15 14/14 smoke PASS, 寫 Day 16 plan doc 揀 scope)
> **Author:** Developer (main agent)
> **Status:** ⏸ Awaiting David scope approval
> **Branch:** 仲未開 — Plan stage 唔郁 source code;David 揀 scope 後先 fork
> **Stack state:** main @ f610e8c, 3 containers Up, Day 15 source baked, 14/14 smoke PASS

---

## 1. 觸發原因

David 2026-06-07 22:50Z 觀察:
- Day 15 Sprint B 完成並 ship(merge `f610e8c`,5 commits,+438/-72 lines)
- 14/14 post-rebuild smoke PASS(per `docs/_meta/day15-smoke-evidence.md`)
- `docs/TECH-DEBT.md` P1 排隊 7 個、P2 排隊 13 個(其中 P2-13 部分守到 — framework 已立)
- David 講「B→A」= smoke 完去 plan Day 16

**重要判斷**:
- Day 15 用 Option B(3 narrow refactor + test infra 起步),**仲有 4 個 P1 + 1 個 P2-13 擴展排隊**
- Plan-first gate 必須先過(scope 闊, 1-2 個 sprint 範圍)
- 唔悶頭做 = 紅線 22(>50 turns 主動建議 /new)+ 紅線 49(plan-first)

## 2. Plan questions resolved (待 David 揀)

| Question | Option | Detail |
|----------|--------|--------|
| Day 16 scope 邊個範圍? | TBD — 揀 A/B/C/D 一個 | 見 §3 比較 |
| Typecheck fix 範圍? | A) 全部 route file 一次過 / B) 只 deal.ts + quotation.ts(rbac) / C) 跳過 | A) 4-6h / B) 2-3h / C) 0h |
| Password migration strategy? | TBD — 配合 scope 揀 | Plan A: 不破壞現有用戶 |

## 3. Scope options (David 揀)

| Option | 範圍 | 工時 | 風險 | 適合情境 |
|--------|------|------|------|----------|
| **A) P1-1 typecheck cleanup** | 移除 8 個 route file 嘅 `@ts-nocheck` + fix 30+ type errors + `bunx prisma generate` | 4-6h / 4-6 commits | 中 — type drift 可能 surface hidden bug | David 清 P0 unblock |
| **B) P1-5 password 強化** | register / change-password: minLength 12 + complexity regex | 1h / 1 commit | 低 — pure validation, 唔動 DB | David 揀 security micro |
| **C) P1-7 status endpoint gate** | `/ai/config/status` 加 `requirePermission('ai-config:read')` | 15 min / 1 commit | 極低 — 1 line 改 | David 揸 fit detail |
| **D) P2-13 unit test 擴展** | 4 個 sample test(rbac 1/4 / withAudit pattern / api.ts wrapper / multi-autocomplete render) | 4-6h / 6-8 commits | 中 — framework 已知 work, scale up | David 繼續測試基礎 |
| **E) 自訂 subset** | 你揀邊幾個 | — | — | — |

### Option A 細節 (P1-1 typecheck cleanup)

**Steps (預 4-6h, 4-6 commits)**:
1. `cd packages/db && bunx prisma generate` 重新 generate client → 確認 `AiConfig` model export
2. Fix `ai-config.ts:57,84,173,199,258` `prisma.aiConfig` reference
3. Fix `chat.ts:78` 嘅 `aiConfig` reference
4. Remove `@ts-nocheck` from `rbac.ts:1` + 補 `userId` / `userIdFromRequest` context type
5. Remove `@ts-nocheck` from `quotation.ts:1` + 補 type
6. Add missing `AuditAction` enum values: `DEAL_STAGE_CHANGED`, `AI_CONFIG_UPDATED`, `CONTACT_DELETED`(已存在)/ `SERVICE_DELETED`(已存在)等
7. Fix `contact.ts:33` `activities` include 問題
8. 補 30+ `Property 'userId' does not exist` errors(via Elysia 1.2 context type augmentation 1 個 file,或者逐 file cast)

**影響 files**: ~10 files,+~200 / -~50 lines,4-6 commits

### Option B 細節 (P1-5 password 強化)

**Steps (預 1h, 1 commit)**:
1. Edit `apps/api/src/routes/auth.ts:62-67, 94-103, 155-159`
2. Register + change-password: `t.Object({ password: t.String({ minLength: 12, pattern: '^(?=.*[0-9])(?=.*[!@#$%^&*]).+$' }) })`
3. Login: minLength 8(唔破壞現有用戶)
4. Seed.ts 加 example strong password note
5. 紅線 13: 唔屬 bug fix, 唔需要 RG-XXX entry
6. 但屬 security patch → add `RG-2026-06-07-PASSWORD-COMPLEXITY` entry + regression test 寫一條 weak password rejected

**影響 files**: ~3 files,+~30 / -~10 lines,1 commit + 1 RG entry

### Option C 細節 (P1-7 status endpoint gate)

**Steps (預 15 min, 1 commit)**:
1. Edit `apps/api/src/routes/ai-config.ts` 個 status endpoint
2. 加 `.use(requirePermission('ai-config:read'))` on status route
3. 紅線 13: 屬 bug fix → `RG-2026-06-07-AI-STATUS-LEAK` entry
4. **不過**:呢個 fix 會 break 現有 `ai-config` page UI(SettingsLayout 用 status 顯示「已配置 / 未配置」 badge)— verify frontend 行為

**影響 files**: 1 file,+1/-0 lines,1 commit + 1 RG entry + 可能 frontend verify

### Option D 細節 (P2-13 unit test 擴展)

**Steps (預 4-6h, 6-8 commits)**:
1. Add 4 個 sample test 喺 `apps/api/src/` + `apps/web/src/`:
   - `rbac.test.ts`: permission matrix 1/4(8 個 permission × 4 個 route 配 8 cases)
   - `with-audit.test.ts`: 抽 mock prisma, test `withAuditDelete` 3 scenarios
   - `api.test.ts` (extension): 加 4 個 wrapper test(login success / 401 → setToken null / 401 → redirect skip / generic error throw)
   - `multi-autocomplete.test.tsx`: render smoke + select 2 個 option
2. 補 `apps/web/src/components/__tests__/api.test.ts` 4 cases
3. Update `docs/TEST-COVERAGE.md` 對應新增嘅 tests

**影響 files**: ~6 files,+~400 / -~10 lines,6-8 commits

## 4. Schema / 數據模型 設計

### 對所有 options: 零 schema 改動
- A) 純 typecheck,零 migration
- B) 純 validation,零 migration
- C) 純 RBAC gate,零 migration
- D) 純 test infra,零 migration

## 5. Backend endpoint / API 設計

### 對所有 options: 零 endpoint 改動
- A) 零新 endpoint
- B) 零新 endpoint(只 validation 規則 bump)
- C) 改 gate, 無新 endpoint
- D) 零新 endpoint(只 test infra)

## 6. Frontend wiring / 設計

### 對所有 options: 零 UI 改動
- A) 零 UI 改
- B) register form 嘅 validation message 可能要 bump "Password must be 12+ chars"
- C) **驗證**:SettingsLayout `ai-config` page 嘅 status badge 嘅 fetch 可能要 re-check auth
- D) 零 UI 改

## 7. RBAC 影響

| Option | RBAC 改動 |
|--------|-----------|
| **A** | 零 RBAC 改動 |
| **B** | 零 RBAC 改動 |
| **C** | `ai-config:read` permission requirement on status endpoint |
| **D** | 零 RBAC 改動 |

## 8. Nav / layout 改動

### 對所有 options: 零 nav 改動

## 9. 實作 steps

### A) P1-1 typecheck (4-6h, 4-6 commits)
```
1. chore(db): bunx prisma generate + verify AiConfig model
2. fix(typecheck): ai-config.ts + chat.ts:78 prisma.aiConfig reference
3. fix(typecheck): remove @ts-nocheck from rbac.ts + context type
4. fix(typecheck): remove @ts-nocheck from quotation.ts
5. fix(enum): add missing AuditAction values (DEAL_STAGE_CHANGED etc)
6. fix(typecheck): contact.ts:33 activities include + remaining 25 errors
```

### B) P1-5 password (1h, 1 commit + 1 RG)
```
1. feat(security): auth.ts password minLength 12 + complexity (register + change-password)
2. docs(regression-guard): add RG-2026-06-07-PASSWORD-COMPLEXITY entry
3. test(api): bun:test weak password rejected (regression)
```

### C) P1-7 status gate (15 min, 1 commit + 1 RG)
```
1. fix(security): ai-config.ts status endpoint requirePermission('ai-config:read')
2. docs(regression-guard): add RG-2026-06-07-AI-STATUS-LEAK entry
3. test(api): bun:test 401 for non-admin access (regression)
4. verify: SettingsLayout ai-config page 唔 break (browser)
```

### D) P2-13 unit tests (4-6h, 6-8 commits)
```
1. test(api): rbac matrix 1/4 (8 cases)
2. test(api): withAuditDelete 3 scenarios with mock prisma
3. test(api): api wrapper 4 cases (login / 401 / redirect skip / error throw)
4. test(web): multi-autocomplete render + select
5. docs(test): TEST-COVERAGE.md update
```

## 10. 影響範圍 (file 預估)

| Option | Files | +Lines | -Lines | Commits |
|--------|-------|--------|--------|---------|
| **A** | ~10 | +~200 | -~50 | 4-6 |
| **B** | ~3 | +~30 | -~10 | 1 + 1 RG |
| **C** | 1 + 1 RG | +1 | -0 | 1 + 1 RG |
| **D** | ~6 | +~400 | -~10 | 6-8 |

## 11. Ship gate 影響

| Red line | Option A | Option B | Option C | Option D |
|----------|----------|----------|----------|----------|
| 10 (8 doc) | ✅ | ✅ | ✅ | ✅ |
| 11 (PRD ↔ tracker) | ✅ | ✅ | ✅ | ✅ |
| 12 (P0 test tasks) | ✅ | 🟡 補 test | 🟡 補 test | ✅ |
| 13 (bug fix → RG) | ✅ | ✅ **+1 RG** | ✅ **+1 RG** | ✅ |
| 14 (root cause) | ✅ | ✅ | ✅ | ✅ |
| 16 (Unit+Integration+E2E) | 🟡 E2E pass, unit 14 | 🟡 +1 unit | 🟡 +1 unit | ✅ **大擴展** |
| 17 (smoke) | ✅ | ✅ | ✅ | ✅ |
| 18 (CVE) | ✅ | ✅ | ✅ | ✅ |

## 12. 唔做嘅嘢 (P0/P1/P2 backlog)

無論揀邊個 option,以下都**唔做**(保護 scope):
- P0-1-6: 已於 Day 14.5 完成
- P1-2: P1-1 嘅子集,跟 P1-1 一齊做
- P1-3: 已於 Day 15 完成
- P1-4: 已於 Day 15 完成
- P1-6 (audit retention cron): 跨 backend + cron infra,留 Day 17+
- P2-13 完整 E2E Playwright 化:留 Day 17+
- 其他 P2 1-12: 留 Day 17+ 排隊

## 13. 決策點 — David 確認

呢個 plan 接受?揀一個:

- **A) P1-1 typecheck cleanup** (4-6h, 4-6 commits, 1 個 sprint) — 紅線 12/16 partial, 30+ type errors 清
- **B) P1-5 password 強化** (1h, 1 commit + RG entry) — security micro, 紅線 13/14
- **C) P1-7 status endpoint gate** (15 min, 1 commit + RG) — security micro
- **D) P2-13 unit test 擴展** (4-6h, 6-8 commits) — 紅線 16 進一步守
- **E) 自訂 subset** — 你揀邊幾個

我嘅 recommendation: **B → C → A** 三個 ordered commits

理由:
1. **B + C 兩個 security micro 各自 1-1.5h**, 加埋 1.5-2h, 1 個 sprint 內
2. **A 4-6h typecheck 屬 unblock P0** — 但 30+ errors 修可能有 surface bug
3. **D 4-6h unit test 屬 scale-up** — Day 15 已起步, Day 16 scale up 合理
4. **B+C < 2h 安全 short sprint** — David 揀「保守」通常對(4-failure-cue + scope 保守 pattern)
5. **紅線 13+14 兩個 fix 觸發** = 必加 RG-XXX entry, 跟 skill SOP

---

## 14. 我嘅下一步(等 David 揀)

揀 A/B/C/D/E 之後我即刻:
1. un-stash(冇 stash)
2. fork branch `<prefix>/day16-<scope>-2026-06-07`
3. 跑 §9 嘅 steps
4. smoke(per Day 15 template)+ tsc + bun audit evidence
5. PR + merge

---

## 15. Day 15 落 Day 16 嘅 context

- ✅ Day 15 5 commits merge main(`f610e8c`)
- ✅ Day 15 14/14 smoke PASS
- ✅ Day 15 unit tests 14 pass(`bun:test` 8 + `vitest` 6)
- ✅ Day 14.7 features 全部 work
- ⚠️ 1 個 smoke 14 號 test 返 200 `success: True` 而非 404 → 屬 `withAuditDelete` helper 早 return path,behavior OK
