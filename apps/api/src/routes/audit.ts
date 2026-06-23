/**
 * Audit log query endpoints (admin only)
 *
 * GET /audit - paginated list of audit events with optional filters
 *   filters: actorId, action, resourceType, resourceId, from, to, limit, offset
 */

import { Elysia } from 'elysia';
import { Prisma, AuditAction } from '@prisma/client';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { requirePermission } from '../middleware/rbac';

export const auditRoutes = new Elysia({ prefix: '/audit', tags: ['audit'] })
  .use(authContext)
  .use(requirePermission('audit:read'))
  .get('/', async ({ query }) => {
    const { actorId, action, resourceType, resourceId, from, to, limit = '50', offset = '0' } = query as {
      actorId?: string;
      action?: string;
      resourceType?: string;
      resourceId?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
    const where: Prisma.AuditLogWhereInput = {};
    if (actorId) where.actorId = actorId;
    if (action) where.action = action as AuditAction;
    if (resourceType) where.resourceType = resourceType;
    if (resourceId) where.resourceId = resourceId;
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as { gte?: Date }).gte = new Date(from);
      if (to) (where.createdAt as { lte?: Date }).lte = new Date(to);
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: Number(limit),
        skip: Number(offset),
        orderBy: { createdAt: 'desc' },
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total, limit: Number(limit), offset: Number(offset) };
  })
  .get('/actions', () => {
    // Return all valid audit actions for filter UI dropdown
    return Object.values(AuditAction);
  })

// ----------------------------------------------------------------
// P1-6 (2026-06-08): Audit log retention policy
// See docs/architecture/0014-audit-log-retention.md for the spec.
//
// The actual pruning is run out-of-band by the cron-style
// `apps/api/src/scripts/audit-log-prune.ts` script. This endpoint
// surfaces the CURRENT policy (defaults from the script's exported
// constants) so an admin can see what the next prune will do
// without actually running it.
//
// The endpoint is read-only: editing the policy is a Phase B
// item (per ADR 0014 §4). For now, the script reads the policy
// from its own constants. When we wire AiConfig-based config,
// the script will need to read the same store as this endpoint.
// ----------------------------------------------------------------
  .get('/retention-policy', async () => {
  // Lazy import so the route file's cold start doesn't pull in
  // the prune script's transitive dependencies unless needed.
  const {
    DEFAULT_RETENTION_DAYS,
    SENSITIVE_RETENTION_DAYS,
    SENSITIVE_ACTIONS,
    PRUNE_BATCH_SIZE,
  } = await import('../scripts/audit-log-prune');
  return {
    defaultRetentionDays: DEFAULT_RETENTION_DAYS,
    sensitiveRetentionDays: SENSITIVE_RETENTION_DAYS,
    sensitiveActions: SENSITIVE_ACTIONS,
    batchSize: PRUNE_BATCH_SIZE,
    lastPrunedAt: null, // Phase B: track last run via a SystemConfig row
    notes:
      'Retention policy is currently hard-coded in the prune script. ' +
      'Edit apps/api/src/scripts/audit-log-prune.ts to change values, ' +
      'then re-run the prune script (or wait for the next cron tick).',
  };
});
