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
  });
