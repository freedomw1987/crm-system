import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { logEvent } from '../middleware/audit';
import { authContext } from '../lib/context';
import { requirePermission } from '../middleware/rbac';

// P0-2 (2026-06-07 review): all deal endpoints (GET list/kanban/:id,
// POST, PATCH stage, PATCH, DELETE) were public. Now gated.

/**
 * Coerce a `?ids=a&ids=b` (array) or `?ids=a,b` (single string) query
 * value into a uniform `string[]`. Used by the multi-select filter
 * params (companyIds, ownerIds, createdByIds). Returns [] when the
 * input is missing or only contains empty strings.
 */
function toIdArray(v: string | string[] | undefined): string[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : v.split(',');
  return arr.map((s) => s.trim()).filter((s) => s.length > 0);
}

export const dealRoutes = new Elysia({ prefix: '/deals', tags: ['deals'] })
  .use(authContext)
  .use(requirePermission('deal:read'))
  // List deals (flat)
  .get('/', async ({ query }) => {
    // 2026-06-09: accept comma-separated `ownerIds` / `companyIds` /
    // `ownerId` / `companyId` so the Deals + Quotation pages can do
    // multi-select filtering. The two shapes are kept in sync so old
    // callers passing a single id still work.
    const {
      ownerId, stageId, status, companyId,
      ownerIds, companyIds,
      limit = '50', offset = '0',
    } = query as {
      ownerId?: string;
      stageId?: string;
      status?: string;
      companyId?: string;
      ownerIds?: string | string[];
      companyIds?: string | string[];
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    // Single-id shorthand (back-compat with the previous API surface)
    if (ownerId) where.ownerId = ownerId;
    if (companyId) where.companyId = companyId;
    // Multi-id: parse `?ownerIds=a&ownerIds=b` (Elysia delivers this as
    // an array) and `?ownerIds=a,b` (single comma-separated string) into
    // a uniform array. Empty / missing means "no filter".
    if (ownerIds) {
      const ids = toIdArray(ownerIds);
      if (ids.length) where.ownerId = { in: ids };
    }
    if (companyIds) {
      const ids = toIdArray(companyIds);
      if (ids.length) where.companyId = { in: ids };
    }
    if (stageId) where.stageId = stageId;
    if (status) where.status = status;
    return prisma.deal.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true, region: { select: { id: true, code: true, name: true, flag: true } } } },
        owner: { select: { id: true, name: true, email: true } },
        stage: { select: { id: true, name: true, probability: true, color: true } },
        _count: { select: { quotations: true } },
      },
    });
  })

  // Day 8: Kanban view — returns stages with nested deals, perfect for drag-drop board
  .use(requirePermission('deal:read'))
  .get('/kanban', async ({ query }) => {
    // 2026-06-09: same multi-select filter as the flat /deals list.
    // `?companyIds=a,b` or `?companyIds=a&companyIds=b` (and same for
    // ownerIds) all work. Single-id shorthand `companyId` / `ownerId`
    // is kept for back-compat.
    const { ownerId, pipelineId, companyId, ownerIds, companyIds } = query as {
      ownerId?: string;
      pipelineId?: string;
      companyId?: string;
      ownerIds?: string | string[];
      companyIds?: string | string[];
    };
    // 1) pick the pipeline (default if not specified)
    const pipeline = pipelineId
      ? await prisma.pipeline.findUnique({ where: { id: pipelineId } })
      : await prisma.pipeline.findFirst({ where: { isDefault: true } });
    if (!pipeline) return { error: 'No pipeline found' };
    // 2) load stages
    const stages = await prisma.pipelineStage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { position: 'asc' },
    });
    // 3) load all deals in one query, then bucket by stage
    const where: Record<string, unknown> = { pipelineId: pipeline.id };
    if (ownerId) where.ownerId = ownerId;
    if (companyId) where.companyId = companyId;
    if (ownerIds) {
      const ids = toIdArray(ownerIds);
      if (ids.length) where.ownerId = { in: ids };
    }
    if (companyIds) {
      const ids = toIdArray(companyIds);
      if (ids.length) where.companyId = { in: ids };
    }
    const deals = await prisma.deal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true, region: { select: { id: true, code: true, name: true, flag: true } } } },
        owner: { select: { id: true, name: true, email: true } },
        // Day 9: include stage so the frontend edit dialog can pre-select
        // the deal's current stage. Without this, `deal.stage` arrives as
        // `undefined` and the form falls back to `stages[0]` (Lead),
        // making every deal LOOK like a Lead no matter where it sits on
        // the Kanban board.
        stage: { select: { id: true, name: true, probability: true, color: true } },
        _count: { select: { quotations: true } },
      },
    });
    // 4) bucket — preserve stage order, include empty stages as []
    const buckets = stages.map((s) => ({
      stage: s,
      deals: deals.filter((d) => d.stageId === s.id),
    }));
    return { pipeline, buckets };
  })

  // Day 8: Move deal to a different stage (Kanban drag-drop endpoint)
  .use(requirePermission('deal:update'))
  .patch('/:id/stage', async ({ params, body, userId, request }) => {
    const { stageId, status } = body as { stageId: string; status?: 'OPEN' | 'WON' | 'LOST' };
    // Verify the new stage exists
    const newStage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
    if (!newStage) return { error: 'Stage not found' };
    // Auto-set status: Won stage → WON, Lost stage → LOST, others → OPEN
    let finalStatus = status;
    if (!finalStatus) {
      if (newStage.name === 'Won') finalStatus = 'WON';
      else if (newStage.name === 'Lost') finalStatus = 'LOST';
      else finalStatus = 'OPEN';
    }
    const updated = await prisma.deal.update({
      where: { id: params.id },
      data: {
        stageId,
        status: finalStatus,
        // If moving to Won/Lost, stamp closedAt
        closedAt: finalStatus !== 'OPEN' ? new Date() : null,
      },
      include: { stage: true },
    });
    await logEvent({
      actorId: userId ?? null,
      action: 'DEAL_STAGE_CHANGED',
      resourceType: 'deal',
      resourceId: params.id,
      description: `Moved deal ${updated.title} to ${newStage.name}`,
      metadata: { stage: newStage.name, status: finalStatus },
      request,
    });
    return updated;
  }, {
    body: t.Object({
      stageId: t.String(),
      status: t.Optional(t.Union([t.Literal('OPEN'), t.Literal('WON'), t.Literal('LOST')])),
    }),
  })

  .use(requirePermission('deal:read'))
  .get('/:id', async ({ params, set }) => {
    const d = await prisma.deal.findUnique({
      where: { id: params.id },
      include: {
        company: true,
        owner: true,
        stage: true,
        pipeline: true,
        activities: { take: 30, orderBy: { createdAt: 'desc' } },
        quotations: { orderBy: { createdAt: 'desc' }, include: { company: { select: { id: true, name: true } } } },
      },
    });
    if (!d) { set.status = 404; return { error: 'Not found' }; }
    return d;
  })
  .use(requirePermission('deal:create'))
  .post('/', async ({ body, set, userId, request }) => {
    const created = await prisma.deal.create({ data: body as never });
    set.status = 201;
    await logEvent({
      actorId: userId ?? null,
      action: 'DEAL_CREATED',
      resourceType: 'deal',
      resourceId: created.id,
      description: `Created deal ${created.title} (value ${created.value})`,
      metadata: { title: created.title, value: Number(created.value), status: created.status },
      request,
    });
    return created;
  })
  .use(requirePermission('deal:update'))
  .patch('/:id', async ({ params, body, userId, request }) => {
    const updated = await prisma.deal.update({ where: { id: params.id }, data: body as never });
    await logEvent({
      actorId: userId ?? null,
      action: 'DEAL_UPDATED',
      resourceType: 'deal',
      resourceId: params.id,
      description: `Updated deal ${updated.title}`,
      metadata: { title: updated.title, fields: Object.keys(body as object) },
      request,
    });
    return updated;
  })
  .use(requirePermission('deal:delete'))
  .delete('/:id', async ({ params, userId, request }) => {
    const before = await prisma.deal.findUnique({ where: { id: params.id }, select: { title: true } });
    await prisma.deal.delete({ where: { id: params.id } });
    if (before) {
      await logEvent({
        actorId: userId ?? null,
        action: 'DEAL_DELETED',
        resourceType: 'deal',
        resourceId: params.id,
        description: `Deleted deal ${before.title}`,
        metadata: { title: before.title },
        request,
      });
    }
    return { success: true };
  });
