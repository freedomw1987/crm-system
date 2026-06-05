import { Elysia } from 'elysia';
import { prisma } from '@crm/db';

export const dealRoutes = new Elysia({ prefix: '/deals', tags: ['deals'] })
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
        company: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, email: true } },
        stage: { select: { id: true, name: true, probability: true, color: true } },
      },
    });
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
      },
    });
    if (!d) { set.status = 404; return { error: 'Not found' }; }
    return d;
  })
  .post('/', async ({ body, set }) => {
    const created = await prisma.deal.create({ data: body as never });
    set.status = 201;
    return created;
  })
  .patch('/:id', async ({ params, body }) => {
    return prisma.deal.update({ where: { id: params.id }, data: body as never });
  })
  .delete('/:id', async ({ params }) => {
    await prisma.deal.delete({ where: { id: params.id } });
    return { success: true };
  });
