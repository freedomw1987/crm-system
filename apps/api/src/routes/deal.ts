import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { logEvent } from '../middleware/audit';

export const dealRoutes = new Elysia({ prefix: '/deals', tags: ['deals'] })
  // List deals (flat)
  .get('/', async ({ query }) => {
    const { ownerId, stageId, status, companyId, limit = '50', offset = '0' } = query as {
      ownerId?: string;
      stageId?: string;
      status?: string;
      companyId?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (ownerId) where.ownerId = ownerId;
    if (stageId) where.stageId = stageId;
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
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
  .get('/kanban', async ({ query }) => {
    const { ownerId, pipelineId } = query as { ownerId?: string; pipelineId?: string };
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
    const deals = await prisma.deal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true, region: { select: { id: true, code: true, name: true, flag: true } } } },
        owner: { select: { id: true, name: true, email: true } },
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
