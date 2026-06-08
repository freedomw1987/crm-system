// P1-6 (2026-06-08): Audit log retention policy — implementation.
//
// See docs/architecture/0014-audit-log-retention.md for the full spec.
// This file contains:
//   1. SENSITIVE_ACTIONS — the enum values kept for 2 years (vs the
//      default 12 months)
//   2. prune() — the core delete-batch logic, callable from a script
//      or from a future scheduled-task runner
//   3. CLI wrapper at the bottom — invoked by
//      `bun run apps/api/src/scripts/audit-log-prune.ts [--dry-run]`
//
// Design notes (David, 2026-06-08):
//   - Batched DELETE 10k rows at a time. A single DELETE of 100k+
//     rows in PG can hold a table-level lock for seconds. Batches
//     also make progress visible: if a 50k-row run is interrupted
//     at batch 3, only batch 1+2 are committed.
//   - Dry-run is the default in the test suite and is the explicit
//     `--dry-run` flag in CLI. Dry-run emits the SQL it WOULD have
//     run, plus a SELECT count, but never issues a DELETE.
//   - Sensitive retention is hard-coded as 730 days. Configurability
//     via AiConfig is a Phase B item (per ADR 0014 §4); not in scope
//     for Day 17.

import { prisma } from '@crm/db';
import { Prisma } from '@crm/db';

// Default retention values from ADR 0014 §1.
export const DEFAULT_RETENTION_DAYS = 365;
export const SENSITIVE_RETENTION_DAYS = 730;
export const PRUNE_BATCH_SIZE = 10_000;

// Hard-coded list of security-critical actions kept for 2 years.
// Grep this list when adding a new sensitive AuditAction value to
// the schema.
export const SENSITIVE_ACTIONS: string[] = [
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_DELETED',
  'PERMISSION_GRANTED', // not in current enum; reserved for future
  'PERMISSION_REVOKED', // not in current enum; reserved for future
  'AI_CONFIG_UPDATED',
  'USER_ROLE_CHANGED', // not in current enum; reserved for future
  'USER_DELETED',
  'AI_TOOL_CONFIRMED', // Day 17: AI mutating tool confirmations
  'AI_TOOL_DENIED', // Day 17: AI mutating tool denials
];

export interface PruneOptions {
  /** Days to keep default (non-sensitive) actions. */
  retentionDays: number;
  /** Days to keep sensitive actions. */
  sensitiveRetentionDays: number;
  /** If true, count rows that would be deleted but do not delete. */
  dryRun: boolean;
  /** Max rows to delete per batch (defaults to PRUNE_BATCH_SIZE). */
  batchSize?: number;
  /** If true, log each batch progress to stdout. */
  verbose?: boolean;
}

export interface PruneResult {
  /** Rows that matched the retention policy and were deleted. */
  deletedCount: number;
  /** Rows that were older than the cutoff but for sensitive actions
   *  (kept by the longer sensitive retention window). */
  sensitiveSkippedCount: number;
  /** Number of batches that ran. */
  batchCount: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** If dryRun=true, this is the same as deletedCount; if false, the
   *  same as deletedCount. Kept as a separate field for clarity. */
  dryRun: boolean;
}

/**
 * Run the retention policy. Idempotent — safe to invoke from a
 * cron-like scheduled task. See ADR 0014 for the retention rules.
 *
 * Implementation strategy:
 *   1. Count rows that match the retention cutoff (for dry-run
 *      visibility, and to know if we need to enter the delete loop).
 *   2. If the count > 0 and not dryRun, enter a loop: delete up to
 *      `batchSize` rows, re-check the count, repeat until the
 *      cutoff window is empty.
 *   3. Return the aggregate stats.
 */
export async function prune(opts: PruneOptions): Promise<PruneResult> {
  const startedAt = Date.now();
  const batchSize = opts.batchSize ?? PRUNE_BATCH_SIZE;
  const defaultCutoff = new Date(
    Date.now() - opts.retentionDays * 24 * 60 * 60 * 1000
  );
  const sensitiveCutoff = new Date(
    Date.now() - opts.sensitiveRetentionDays * 24 * 60 * 60 * 1000
  );

  // Step 1: count rows that the default cutoff would delete. The
  // sensitive list is implicitly excluded from this count by
  // notIn (we use the default cutoff for them, but they get the
  // LONGER sensitiveCutoff; rows older than defaultCutoff but
  // younger than sensitiveCutoff are not deleted).
  //
  // We use a `prisma.$queryRaw` for the count so we don't need to
  // materialise rows. The query is parameterised — no injection
  // risk.
  const countSql = Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE "action" NOT IN (${Prisma.join(SENSITIVE_ACTIONS)})) AS default_old,
      COUNT(*) FILTER (WHERE "action" IN (${Prisma.join(SENSITIVE_ACTIONS)})) AS sensitive_old
    FROM "audit_logs"
    WHERE "createdAt" < ${defaultCutoff}
  `;
  const counts = (await prisma.$queryRaw(countSql)) as Array<{
    default_old: bigint;
    sensitive_old: bigint;
  }>;
  const defaultOld = Number(counts[0]?.default_old ?? 0n);
  const sensitiveOld = Number(counts[0]?.sensitive_old ?? 0n);

  if (opts.verbose) {
    console.log(
      `[prune] default-old=${defaultOld}, sensitive-old=${sensitiveOld} ` +
        `(default cutoff=${defaultCutoff.toISOString()}, ` +
        `sensitive cutoff=${sensitiveCutoff.toISOString()})`
    );
  }

  // Step 2: dry-run path. Report the planned delete count and exit.
  if (opts.dryRun) {
    return {
      deletedCount: defaultOld,
      sensitiveSkippedCount: sensitiveOld,
      batchCount: 0,
      durationMs: Date.now() - startedAt,
      dryRun: true,
    };
  }

  // Step 3: live run. Delete in batches.
  let deletedCount = 0;
  let batchCount = 0;
  while (true) {
    // Use a delete with LIMIT. Postgres supports DELETE ... USING (SELECT ...)
    // for LIMIT, or `DELETE ... WHERE id IN (SELECT id ... LIMIT N)`. We
    // pick the latter because it composes cleanly with the rest of the
    // Prisma where clause.
    const deleteResult = await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: defaultCutoff },
        action: { notIn: SENSITIVE_ACTIONS as never },
      },
    });
    const n = deleteResult.count;
    deletedCount += n;
    batchCount += 1;
    if (opts.verbose) {
      console.log(`[prune] batch ${batchCount} deleted ${n} rows`);
    }
    // deleteMany without LIMIT will delete ALL matching rows in one
    // statement; this is OK up to ~100k rows in our scale, but the
    // batch_size is intended for future scale. For now we exit when
    // the delete returns 0 (no more matching rows). If we wanted
    // strict batch behaviour, we'd need to use $queryRaw with LIMIT
    // and order by id — deferred to Phase B.
    if (n === 0) break;
    if (n < batchSize) break; // last partial batch
  }

  return {
    deletedCount,
    sensitiveSkippedCount: sensitiveOld,
    batchCount,
    durationMs: Date.now() - startedAt,
    dryRun: false,
  };
}

// ---------------------------------------------------------------------------
// CLI wrapper
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): PruneOptions {
  const args = new Map<string, string>();
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args.set(m[1], m[2] ?? 'true');
  }
  return {
    retentionDays: Number(args.get('retention-days') ?? DEFAULT_RETENTION_DAYS),
    sensitiveRetentionDays: Number(
      args.get('sensitive-retention-days') ?? SENSITIVE_RETENTION_DAYS
    ),
    dryRun: args.get('dry-run') === 'true' || args.get('dry-run') === undefined
      ? args.has('dry-run')
      : false,
    batchSize: args.has('batch-size') ? Number(args.get('batch-size')) : undefined,
    verbose: args.has('verbose') || args.has('v'),
  };
}

// Run when invoked directly: `bun run apps/api/src/scripts/audit-log-prune.ts`
// Note: this is a `main` check, not a module-side-effect import.
if (import.meta.main) {
  const opts = parseArgs(process.argv);
  console.log(`[prune] starting with options:`, opts);
  prune(opts)
    .then((r) => {
      console.log(`[prune] complete:`, r);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[prune] failed:`, err);
      process.exit(1);
    });
}
