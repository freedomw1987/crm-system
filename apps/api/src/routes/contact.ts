import { Elysia } from 'elysia';
import { prisma } from '@crm/db';

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
  .post('/', async ({ body, set }) => {
    const created = await prisma.contact.create({ data: body as never });
    set.status = 201;
    return created;
  })
  .patch('/:id', async ({ params, body }) => {
    return prisma.contact.update({ where: { id: params.id }, data: body as never });
  })
  .delete('/:id', async ({ params }) => {
    await prisma.contact.delete({ where: { id: params.id } });
    return { success: true };
  });
