# 2026-06-07 — Day 15 Sprint Plan

> **Stage:** Plan (David 揀咗 "您開工吧" 2026-06-07 — 寫 plan doc 畀 David review scope 先)
> **Author:** Developer (main agent)
> **Status:** ⏸ Awaiting David scope approval
> **Branch:** 仲未開 — Plan stage 唔郁 source code;David 揀 scope 後先 fork

---

## 1. 觸發原因

David 2026-06-07 觀察:
- Day 14.5 P0 security patch (commit `4d24a99`) + Day 14.7 Settings + Tax (merge `019cab8`) 兩個 sprint ship 咗
- Q2 ticket 落咗 `docs/TECH-DEBT.md` P2-13 (red-line 16 zero test infra)
- David 講「您開工吧」= 批准啟動 Day 15 sprint

但**Day 15 scope 範圍 1 個 question**:
- `docs/TECH-DEBT.md` 而家 P0 (0) + P1 (7) + P2 (13) 排隊,範圍 1-2 個 sprint
- 唔 align scope 就悶頭做 = 4 個鐘後 David 寫「唔啱 / 縮 scope」= throwaway
- Plan-first gate 必須先過

## 2. Plan questions resolved (David 揀咗)

| Question | Option | Detail |
|----------|--------|--------|
| Day 15 scope 邊個範圍? | TBD — 揀 A/B/C/D 一個 | 見 §3 比較 |
| Test infra 框架? | bun:test (api) + vitest (web) | skill 建議,與現有 stack 一致 |
| @ts-nocheck 處理次序? | TBD — 配合 scope 揀 | P1-1 vs 跳過 |

## 3. Scope options (David 揀)

| Option | 範圍 | 工時 | 風險 | 適合情境 |
|--------|------|------|------|----------|
| **A) 完整 P1 sprint** | P1-1 + P1-2 + P1-3 + P1-4 + P1-5 + P1-6 + P1-7 (7 個) | 12-18h / 1.5-2 sprints | 高 — 跨越 7 個 domain,merge 衝突風險 | David 一次過清 tech debt 排隊 |
| **B) 最小 P1 + P2-13 開頭** | P1-3 (withAudit helper) + P1-4 (query-helpers dedup) + P2-13 (test infra 起步) | 3-4h / 1 個 sprint | 低 — 3 個 narrow refactor,容易 review | David 保守 + 起步 test infra |
| **C) 只 P2-13 (test infra)** | bun:test setup + vitest setup + 1 個 sample test,證明 framework work | 4-6h / 1 個 sprint | 中 — framework 選錯要重做 | David 集中精力建立基礎 |
| **D) 你揀** | 自訂 subset | — | — | David 揸 fit detail |

### Option A 細節 (P1 完整 sprint)

**Steps (預 12-18h, ~12-15 commits)**:
1. P1-1: 移除 `apps/api/src/routes/{rbac,quotation}.ts` `@ts-nocheck`,逐 file fix 30+ type errors
2. P1-2: `bunx prisma generate` 重新 generate + verify `AiConfig` model
3. P1-3: 抽 `withAudit({action, resourceType, fn})` helper + refactor 3 個 delete handlers
4. P1-4: 抽 `toIdArray` 入 `lib/query-helpers.ts` + 兩個 route import
5. P1-5: password minLength 12 + complexity regex (register + change-password)
6. P1-6: audit log retention cron (12 個月 default + 24 個月 sensitive)
7. P1-7: AI Config status endpoint 加 `requirePermission('ai-config:read')`

**影響 files**: ~14 files,+~350 / -~120 lines,7-12 commits

### Option B 細節 (3 個 narrow refactor)

**Steps (預 3-4h, ~4-5 commits)**:
1. P1-3: 抽 `withAudit` helper (2h)
2. P1-4: 抽 `toIdArray` 入 `lib/query-helpers.ts` (30 min)
3. P2-13a: `apps/api/package.json` `"test"` 改 `"bun:test"` script + 1 sample test 證明 framework work (1h)
4. P2-13b: `apps/web/package.json` 加 `"test": "vitest"` script + 1 sample RTL test (1h)

**影響 files**: ~8 files,+~150 / -~80 lines,4-5 commits

### Option C 細節 (只 P2-13)

**Steps (預 4-6h, ~6-8 commits)**:
1. `apps/api/package.json` 加 `bun:test` dev dep + bunfig.toml 配 test config
2. 寫 `apps/api/src/lib/__tests__/with-audit.test.ts`(先不 refactor,用 mock 證明 helper pattern work)
3. 寫 `apps/api/src/routes/__tests__/auth-rbac.test.ts`(permission matrix 1/4)
4. `apps/web/package.json` 加 `vitest` + `@testing-library/react` dev deps
5. 寫 `apps/web/src/lib/__tests__/api.test.ts`(request wrapper smoke)
6. 寫 `apps/web/src/components/__tests__/multi-autocomplete.test.tsx`(critical component)

**影響 files**: ~10 files,+~300 / -10 lines,6-8 commits

## 4. Schema / 數據模型 設計

### 對所有 options: 零 schema 改動
- P1-1: 純 typecheck fix,零 migration
- P1-3: 純 refactor,零 migration
- P1-4: 純 refactor,零 migration
- P1-5: 純 validation 改,零 migration
- P1-6: 1 個 migration (audit log retention policy table,可選)
- P1-7: 純 RBAC gate,零 migration
- P2-13: 純 test infra,零 migration

## 5. Backend endpoint / API 設計

### 對所有 options: 零 endpoint 改動
- P1-1-4: 純 refactor / typecheck,無新 endpoint
- P1-5: 改 validation 規則,無新 endpoint
- P1-6: 新增 `/api/admin/retention-policy` GET/PUT (僅 P1-6 適用)
- P1-7: 改 gate,無新 endpoint
- P2-13: 純 test infra,無新 endpoint

## 6. Frontend wiring / 設計

### 對所有 options: 零 UI 改動
- P1-3 / P1-4: 後端 refactor,前端零影響
- P1-5: 前端 login/register form 嘅 validation 提示可能要 bump minLength message
- P1-6: 新增 Settings → Audit retention tab
- P1-7: 純後端 gate,前端 zero
- P2-13: 純 test infra,前端 zero

## 7. RBAC 影響

| Option | RBAC 改動 |
|--------|-----------|
| **A** | P1-7 加 `ai-config:read` permission requirement on status endpoint (1 個 permission wire 改) |
| **B** | 零 RBAC 改動 |
| **C** | 零 RBAC 改動 |

## 8. Nav / layout 改動

### 對所有 options: 零 nav 改動
(只有 P1-6 會加 retention policy tab 入 /settings/audit,但係 Day 14.7 嘅 restructure 已經有,可能 zero nav)

## 9. 實作 steps

### A) 完整 P1 sprint (12-18h, 7-12 commits)

```
1. feat(refactor): P1-4 extract toIdArray → lib/query-helpers.ts (0.5h, 1 commit)
2. feat(refactor): P1-3 extract withAudit({action, resourceType, fn}) helper (2h, 2 commits)
3. fix(typecheck): P1-1 remove @ts-nocheck from rbac.ts (1h, 1 commit)
4. fix(typecheck): P1-1 remove @ts-nocheck from quotation.ts (1h, 1 commit)
5. fix(typecheck): P1-1+2 regenerate prisma client + fix aiConfig reference (1h, 1 commit)
6. fix(typecheck): P1-1 fix 25+ remaining type errors per file (2-3h, 4-5 commits)
7. feat(security): P1-5 password minLength 12 + complexity regex (1h, 1 commit)
8. feat(api): P1-7 ai-config status requirePermission('ai-config:read') (15 min, 1 commit)
9. feat(ops): P1-6 audit log retention cron (4-6h, 2-3 commits) [可選最後做]
10. smoke + tsc + bun audit evidence report
```

### B) 3 個 narrow refactor (3-4h, 4-5 commits)

```
1. feat(refactor): P1-4 extract toIdArray (0.5h, 1 commit)
2. feat(refactor): P1-3 extract withAudit helper (2h, 2 commits)
3. test(api): P2-13a bun:test setup + 1 sample test (1h, 1 commit)
4. test(web): P2-13b vitest + RTL setup + 1 sample test (1h, 1 commit)
```

### C) 只 P2-13 test infra (4-6h, 6-8 commits)

```
1. chore(api): add bun:test dev dep + test script (15 min, 1 commit)
2. test(api): withAudit pattern test (mock based) (1h, 1 commit)
3. test(api): auth-rbac matrix test (1/4) (1.5h, 2 commits)
4. chore(web): add vitest + RTL dev deps + test script (15 min, 1 commit)
5. test(web): api.ts request wrapper smoke (1h, 1 commit)
6. test(web): multi-autocomplete render smoke (1h, 1 commit)
7. docs(test): TEST-COVERAGE.md 更新 framework 設置
```

## 10. 影響範圍 (file 預估)

| Option | Files | +Lines | -Lines | Commits |
|--------|-------|--------|--------|---------|
| **A** | ~14 | +~350 | -~120 | 7-12 |
| **B** | ~8 | +~150 | -~80 | 4-5 |
| **C** | ~10 | +~300 | -10 | 6-8 |

## 11. Ship gate 影響

| Red line | Option A | Option B | Option C |
|----------|----------|----------|----------|
| 10 (8 doc) | ✅ 無新 doc 必要 | ✅ | ✅ |
| 11 (PRD ↔ tracker) | ✅ | ✅ | ✅ |
| 12 (P0 test tasks) | 🟡 P1-5 補 auth validation, 加 test | ✅ | ✅ |
| 13 (bug fix → RG) | ✅ 無 bug fix | ✅ | ✅ |
| 14 (root cause) | ✅ | ✅ | ✅ |
| 16 (Unit+Integration+E2E) | 🟡 Option C 補 E2E 之外 | 🟡 起 bun:test + vitest | ✅ **直接守到 16** |
| 17 (smoke before deploy) | ✅ | ✅ | ✅ |
| 18 (CVE = 0) | ✅ bun audit 跑 | ✅ | ✅ |

**關鍵判斷**:Option C 直接守到紅線 16 (test infra 建立 = 從 0 變 framework ready)。
Option A/B 嘅 tech debt 清完,**都仲未** 滿足紅線 16 (P0 US 嘅 test 仲未寫)。

## 12. 唔做嘅嘢 (P1/P2 backlog)

無論揀邊個 option,以下都**唔做**(保護 scope):
- P0-1-6: 已於 Day 14.5 完成
- P0 全部: 已 ship
- P2-1-12: P2 backlog,唔做
- frontend Zod runtime validation (P2-2): David 唔批准過唔做
- 完整 E2E Playwright conversion:P2-13 起 framework 但 full conversion 留 Day 16+
- Audit log retention cron (P1-6) 嘅 admin UI:留 Settings tab 之後 sprint

## 13. 決策點 — David 確認

呢個 plan 接受?揀一個:

- **A) 完整 P1 sprint** (12-18h, 7-12 commits, 1.5-2 sprints)— David 一次過清 tech debt 排隊
- **B) 最小 P1 + P2-13 開頭** (3-4h, 4-5 commits, 1 個 sprint)— David 保守 + 起步 test infra
- **C) 只 P2-13 (test infra)** (4-6h, 6-8 commits, 1 個 sprint)— David 集中精力建立基礎,**直接守到紅線 16**
- **D) 你揀** — 自訂 subset,講邊幾個

我嘅 recommendation: **B**

理由:
1. 1 個 sprint 內完成,scope 容易 review
2. 3 個 narrow refactor 全部 low-risk,失敗 cost 細
3. P2-13 起步(framework + 1 sample test)證明方向 work,**Day 16 可以 scale up**
4. 唔強行食 P1-5 (password) + P1-6 (retention cron) + P1-7 (status gate) — 呢 3 個留 Day 16 sprint 一齊做
5. 唔悶頭 18h sprint — 跟你過去 "Build 完會主動要求 RWD mobile compat" + 4-failure-cue 模式脗合

---

## 14. Stash 狀態

David 嘅 working changes(stash@{0})仲 stash 住。任何 option 開工前**先 un-stash 確認 conflict**:

```bash
git stash show -p stash@{0}  # 睇下改咗咩
git stash pop                # merge 返入 working tree
```

預期 conflict:Day 14.7 已 merge David 嘅 3 個 multi-autocomplete components + 1 個 Deal Autocomplete commit,所以 David working 嘅 4 modified + 3 untracked 應該已 landing。Stash pop 應該冇 conflict,但會 surface 出 David 自己嘅 progress。

## 15. 我嘅下一步(等 David 揀)

揀 A/B/C/D 之後我即刻:
1. un-stash David working changes + verify conflict-free
2. fork branch `<prefix>/day15-<scope>-2026-06-07`
3. 跑 §9 嘅 steps
4. smoke + tsc + bun audit evidence
5. PR + merge
