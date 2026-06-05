import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { logEvent } from '../middleware/audit';

export const companyRoutes = new Elysia({ prefix: '/companies', tags: ['companies'] })
  // List companies
  .get('/', async ({ query }) => {
    const { search, status, region, limit = '20', offset = '0' } = query as {
      search?: string;
      status?: string;
      region?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (region) where.region = region;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { legalName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.company.findMany({
        where,
        take: Number(limit),
        skip: Number(offset),
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { contacts: true, quotations: true, deals: true } } },
      }),
      prisma.company.count({ where }),
    ]);
    return { items, total, limit: Number(limit), offset: Number(offset) };
  })

  // Get single company
  .get('/:id', async ({ params, set }) => {
    const company = await prisma.company.findUnique({
      where: { id: params.id },
      include: {
        contacts: true,
        addresses: true,
        tags: { include: { tag: true } },
        quotations: { take: 10, orderBy: { createdAt: 'desc' } },
        deals: { take: 10, orderBy: { createdAt: 'desc' } },
        activities: { take: 20, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!company) {
      set.status = 404;
      return { error: 'Company not found' };
    }
    return company;
  })

  // Create company
  .post('/', async ({ body, set, userId, request }) => {
    const data = body as Record<string, unknown>;
    const company = await prisma.company.create({ data: data as never });
    set.status = 201;
    await logEvent({
      actorId: userId ?? null,
      action: 'COMPANY_CREATED',
      resourceType: 'company',
      resourceId: company.id,
      description: `Created company ${company.name}`,
      metadata: { name: company.name, status: company.status },
      request,
    });
    return company;
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      legalName: t.Optional(t.String()),
      taxId: t.Optional(t.String()),
      industry: t.Optional(t.String()),
      website: t.Optional(t.String()),
      phone: t.Optional(t.String()),
      email: t.Optional(t.String({ format: 'email' })),
      notes: t.Optional(t.String()),
      source: t.Optional(t.String()),
      region: t.Optional(t.Union([
        t.Literal('HK'),
        t.Literal('MO'),
        t.Literal('CN'),
        t.Literal('OTHER'),
      ])),
      customRegion: t.Optional(t.String()),
      creditLimit: t.Optional(t.Number()),
      paymentTerms: t.Optional(t.String()),
    }),
  })

  // Update company
  .patch('/:id', async ({ params, body, set, userId, request }) => {
    try {
      const data = body as Record<string, unknown>;
      const company = await prisma.company.update({
        where: { id: params.id },
        data: data as never,
      });
      await logEvent({
        actorId: userId ?? null,
        action: 'COMPANY_UPDATED',
        resourceType: 'company',
        resourceId: params.id,
        description: `Updated company ${company.name}`,
        metadata: { name: company.name, fields: Object.keys(data) },
        request,
      });
      return company;
    } catch {
      set.status = 404;
      return { error: 'Company not found' };
    }
  })

  // Delete company
  .delete('/:id', async ({ params, set, userId, request }) => {
    try {
      const before = await prisma.company.findUnique({ where: { id: params.id }, select: { name: true } });
      await prisma.company.delete({ where: { id: params.id } });
      if (before) {
        await logEvent({
          actorId: userId ?? null,
          action: 'COMPANY_DELETED',
          resourceType: 'company',
          resourceId: params.id,
          description: `Deleted company ${before.name}`,
          metadata: { name: before.name },
          request,
        });
      }
      return { success: true };
    } catch {
      set.status = 404;
      return { error: 'Company not found' };
    }
  });
