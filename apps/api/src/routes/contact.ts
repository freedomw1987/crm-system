import { Elysia } from 'elysia';
import { prisma } from '@crm/db';
import { logEvent } from '../middleware/audit';

export const contactRoutes = new Elysia({ prefix: '/contacts', tags: ['contacts'] })
  .get('/', async ({ query }) => {
    const { companyId, search, limit = '50', offset = '0' } = query as {
      companyId?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    return prisma.contact.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
      orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }],
      include: { company: { select: { id: true, name: true } } },
    });
  })
  .get('/:id', async ({ params, set }) => {
    const c = await prisma.contact.findUnique({
      where: { id: params.id },
      include: { company: true, addresses: true, activities: { take: 20 } },
    });
    if (!c) { set.status = 404; return { error: 'Not found' }; }
    return c;
  })
  .post('/', async ({ body, set, userId, request }) => {
    const created = await prisma.contact.create({ data: body as never });
    set.status = 201;
    await logEvent({
      actorId: userId ?? null,
      action: 'CONTACT_CREATED',
      resourceType: 'contact',
      resourceId: created.id,
      description: `Created contact ${created.firstName} ${created.lastName}`,
      metadata: { name: `${created.firstName} ${created.lastName}`, companyId: created.companyId },
      request,
    });
    return created;
  })
  .patch('/:id', async ({ params, body, userId, request }) => {
    const updated = await prisma.contact.update({ where: { id: params.id }, data: body as never });
    await logEvent({
      actorId: userId ?? null,
      action: 'CONTACT_UPDATED',
      resourceType: 'contact',
      resourceId: params.id,
      description: `Updated contact ${updated.firstName} ${updated.lastName}`,
      metadata: { name: `${updated.firstName} ${updated.lastName}`, fields: Object.keys(body as object) },
      request,
    });
    return updated;
  })
  .delete('/:id', async ({ params, userId, request }) => {
    const before = await prisma.contact.findUnique({ where: { id: params.id }, select: { firstName: true, lastName: true } });
    await prisma.contact.delete({ where: { id: params.id } });
    if (before) {
      await logEvent({
        actorId: userId ?? null,
        action: 'CONTACT_DELETED',
        resourceType: 'contact',
        resourceId: params.id,
        description: `Deleted contact ${before.firstName} ${before.lastName}`,
        metadata: { name: `${before.firstName} ${before.lastName}` },
        request,
      });
    }
    return { success: true };
  });
