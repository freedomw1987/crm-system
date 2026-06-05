// @ts-nocheck — see rbac.ts for the Elysia 1.2 + TS 5.x d.ts trade-off
/**
 * Product catalogue routes (Day 7: audit-logged).
 */
import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';

export const productRoutes = new Elysia({ prefix: '/products', tags: ['products'] })
  .use(authContext)
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
  .post('/', async ({ body, set, userId, request }) => {
    const created = await prisma.product.create({ data: body as never });
    set.status = 201;
    await logEvent({
      actorId: userId ?? null,
      action: 'PRODUCT_CREATED',
      resourceType: 'product',
      resourceId: created.id,
      description: `Created product ${created.name} (${created.sku})`,
      metadata: { name: created.name, sku: created.sku },
      request,
    });
    return created;
  })
  .patch('/:id', async ({ params, body, userId, request }) => {
    const updated = await prisma.product.update({ where: { id: params.id }, data: body as never });
    await logEvent({
      actorId: userId ?? null,
      action: 'PRODUCT_UPDATED',
      resourceType: 'product',
      resourceId: params.id,
      description: `Updated product ${updated.name}`,
      metadata: { name: updated.name, fields: Object.keys(body as object) },
      request,
    });
    return updated;
  })
  .delete('/:id', async ({ params, userId, request }) => {
    const before = await prisma.product.findUnique({ where: { id: params.id }, select: { name: true, sku: true } });
    await prisma.product.delete({ where: { id: params.id } });
    if (before) {
      await logEvent({
        actorId: userId ?? null,
        action: 'PRODUCT_DELETED',
        resourceType: 'product',
        resourceId: params.id,
        description: `Deleted product ${before.name} (${before.sku})`,
        metadata: { name: before.name, sku: before.sku },
        request,
      });
    }
    return { success: true };
  });
