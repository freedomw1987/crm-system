import { Elysia } from 'elysia';
import { prisma } from '@crm/db';

export const productRoutes = new Elysia({ prefix: '/products', tags: ['products'] })
  .get('/', async ({ query }) => {
    const { search, category, status, limit = '50', offset = '0' } = query as {
      search?: string;
      category?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    return prisma.product.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
      orderBy: { name: 'asc' },
    });
  })
  .get('/:id', async ({ params, set }) => {
    const p = await prisma.product.findUnique({
      where: { id: params.id },
      include: { quotationItems: { take: 10 } },
    });
    if (!p) { set.status = 404; return { error: 'Not found' }; }
    return p;
  })
  .post('/', async ({ body, set }) => {
    const created = await prisma.product.create({ data: body as never });
    set.status = 201;
    return created;
  })
  .patch('/:id', async ({ params, body }) => {
    return prisma.product.update({ where: { id: params.id }, data: body as never });
  })
  .delete('/:id', async ({ params }) => {
    await prisma.product.delete({ where: { id: params.id } });
    return { success: true };
  });
