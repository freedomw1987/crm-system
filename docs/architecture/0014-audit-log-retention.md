# ADR 0014: Audit Log Retention Policy

**Status**: PROPOSED (David 2026-06-07 P1-6 spec, awaiting validation)
**Date**: 2026-06-07
**Author**: Tree Monstor (Day 14 P1-6 spec commit)
**Supersedes**: —
**Related**: `packages/db/prisma/schema.prisma` line 793 (`model AuditLog`)

---

## Context

`AuditLog` table 已存在並持續寫入(entity-level mutations: `COMPANY_*` / `DEAL_*` / `QUOTATION_*` / `MAN_DAY_ROLE_*` / `ACTIVITY_*` / `ATTACHMENT_*` / `AI_CONFIG_UPDATED` / `USER_*` / `ROLE_*` / `PERMISSION_*` / `PRODUCT_*` / `PIPELINE_*` / `PIPELINE_STAGE_*`)。

**目前冇 retention 政策**:rows 永久保留,DB 體積單調增長,**無清理 path**。

**Day 14 觀察**:Day 7–13 期間已累積 N 條 entries(待測量)。若 production 上線後 1–2 年,audit table 會膨脹到 100k+ rows,影響:
- `GET /api/audit-log?entityType=…&entityId=…` 查詢速度
- Backup size / RDS storage cost
- GDPR / 個資法保留上限(台灣/香港個資法一般要求「目的達成後刪除」,audit log 例外但要明文 policy)

---

## Decision(待 David validate)

### 1. 保留期:**12 個月 rolling**(預設值,可在 `AiConfig` 內 override)

| 類別 | 保留期 | 理由 |
|------|--------|------|
| **Default 全部 `AuditLog` rows** | **365 日** | 業界 SaaS 標準(Slack/Notion/HubSpot 12–24 月);法規友善;對應內部 audit window |
| **敏感 actions** (role/permission/per-ai-config 變更) | **730 日(2 年)** | 資安 incident 調查需更長 trail |
| **Soft-deleted entity 對應 audit** | **隨 entity 一齊 purge** | GDPR 個資最小化 |

### 2. 清理路徑:**Hourly cron + PG partition(後期)**

**Phase A(MVP, Day 14 ship)**:
- 新增 `apps/api/src/scripts/audit-log-prune.ts` — standalone script
- 接收 `--retention-days=365 --dry-run` flag
- SQL: `DELETE FROM "AuditLog" WHERE "createdAt" < NOW() - INTERVAL '365 days' AND "action" NOT IN (sensitive_list)`
- Cron(ECS scheduled task 或 K8s CronJob): 每日 03:00 HKT 跑一次
- 刪除前 emit `info` log:`Pruned N audit log rows older than 365 days`
- 敏感 actions 不刪(spec 寫死 enum list)

**Phase B(>6 個月後, 1M+ rows 時才做)**:
- 改 PG native partitioning(`PARTITION BY RANGE (createdAt)`)
- 每月一個 partition, cron 自動 `DETACH PARTITION` 過期 partition + `DROP`
- Query plan 改善(pruning)

### 3. 訪問層:**No new API change**

- 現有 `GET /api/audit-log` 維持
- 加 `?since=YYYY-MM-DD` query param(已有就 skip)
- 不加 export endpoint(spec 唔需要)

### 4. Configurability(可選)

- `AiConfig` table 新增 row: `audit_retention_days` 預設 365
- Admin 改 → cron script 讀最新 value
- 改 0 = disable pruning(慎用)

### 5. Logging / Observability

- Prune script 每次 emit metric:`audit_log.pruned_rows{dry_run, sensitive_skipped}`
- CloudWatch / 監控 alert if `pruned_rows > 100k/day`(異常爆量)

---

## Consequences

### Positive ✅
- 12 月 rolling window 符合業界 SOP,法規友善
- Sensitive actions(security-critical)保留 2 年,資安 trace 足夠
- 預估 DB size 穩態(假設每日 100 audit events,12 月 ≈ 36k rows,可控)
- Phase A 簡單(1 script + 1 cron),Phase B scale-up path 清晰

### Negative ⚠️
- 365 日前嘅 audit 永久 lost(可接受 — 12 月已超出大部分合約 audit window)
- Phase A DELETE 會 lock table(若 100k+ rows 一次過 delete)→ **必須 batch**(每次 10k rows,loop)
- Sensitive list hard-coded 喺 script(將來加新 sensitive action 要更新 spec)

### Risks 🚨
- **Risk 1**: 開發環境若冇 prune,測試時 row 累積爆 → spec 加:dev retention 設 30 日,prod 365 日
- **Risk 2**: 改 retention policy 需要資料遷移(export 前 365 日再 import)→ spec 預留 migration hook
- **Risk 3**: 若 Prisma model 改 column,DELETE 條件要追蹤 → spec 加 comment 註明依賴 `createdAt` index

---

## Implementation Spec(待 David sign-off 後落實)

### Migration(0 個 schema 改動)
- ❌ 不動 `model AuditLog`
- ✅ 只係加 prune script + cron

### Files to create
```
apps/api/src/scripts/audit-log-prune.ts     # 主 script (200-300 lines)
apps/api/src/scripts/__tests__/audit-log-prune.test.ts  # unit test
infra/cron/audit-log-prune-taskdef.json     # ECS scheduled task spec
```

### Sensitive actions list(初期)
```typescript
const SENSITIVE_ACTIONS: AuditAction[] = [
  'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED',
  'PERMISSION_GRANTED', 'PERMISSION_REVOKED',
  'AI_CONFIG_UPDATED',
  'USER_ROLE_CHANGED', 'USER_DELETED',
];
```

### Open Questions(等 David answer)
- [ ] 12 月 vs 24 月?(我建議 12)
- [ ] Sensitive list 預設以上 7 個,有冇 add?
- [ ] ECS scheduled task vs CloudWatch Events rule?(我建議 ECS — 跟 Day 13 ECS Fargate stack 一致)
- [ ] Dev retention 30 日 OK?
- [ ] 是否需要 export endpoint 給 compliance team?(我建議唔需要,MVP)

---

## Validation Checklist(Ship 前)

- [ ] David 簽名 approval 喺呢個 ADR 底部
- [ ] Migration 0 改動,test DB 跑 prune script + 確認 dry-run 邏輯正確
- [ ] `--dry-run` 唔可以動 DB rows(grep test output)
- [ ] Sensitive list rows 全部保留超過 730 日(stub 1 個 800 日前 sensitive row 做 fixture)
- [ ] Unit test 100% pass(DELETE 條件 / batch 邏輯 / sensitive skip)
- [ ] Cron task 喺 dev ECS 跑一次,確認 `info` log 出 + 0 row pruned(因為 dev 冇舊 data)
- [ ] `docs/API.md` 加 audit-log 嘅 retention 章節(brief paragraph)

---

## Appendix A: AuditLog schema(現狀,line 793+)

```prisma
model AuditLog {
  id           String      @id @default(cuid())
  actorId      String?     // null = anonymous / system
  action       AuditAction
  entityType   String      // e.g. "Company" / "Deal" / "Quotation"
  entityId     String
  metadata     Json?       // before/after diff, IP, user agent, etc.
  createdAt    DateTime    @default(now())

  actor        User?       @relation("AuditActor", fields: [actorId], references: [id], onDelete: SetNull)
  @@index([entityType, entityId])
  @@index([actorId])
  @@index([createdAt])     // ← retention policy 依賴呢個 index
  @@map("audit_logs")
}
```
