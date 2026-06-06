import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { logEvent } from '../middleware/audit';

export const companyRoutes = new Elysia({ prefix: '/companies', tags: ['companies'] })
  // List companies
  .get('/', async ({ query }) => {
    const { search, status, region, limit = '20', offset = '0' } = query as {
      search?: string;
      status?: string;
      /**
       * Day 9: `region` accepts a Region.code (e.g. "HK") or a Region.id
       * (cuid). Internally we resolve to regionId for the WHERE clause.
       */
      region?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (region) {
      // Try resolving as a Region.code first, fall back to a direct id match.
      const regionRecord = await prisma.region.findFirst({
        where: { OR: [{ code: region }, { id: region }] },
        select: { id: true },
      });
      if (regionRecord) where.regionId = regionRecord.id;
      else where.regionId = region; // accept raw id even if not in catalogue
    }
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
        include: {
          _count: { select: { contacts: true, quotations: true, deals: true } },
          region: { select: { id: true, code: true, name: true, flag: true } },
        },
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
        region: { select: { id: true, code: true, name: true, flag: true } },
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
    // Day 9: accept either `regionId` (cuid) or `region` (code). The Region
    // table is the source of truth; we resolve the code to an id and drop
    // the legacy `region` field before handing the data to Prisma.
    const { regionId, region: regionCode, ...rest } = data as {
      regionId?: string;
      region?: string;
    };
    let resolvedRegionId: string | null = regionId ?? null;
    if (!resolvedRegionId && regionCode) {
      const r = await prisma.region.findFirst({
        where: { code: regionCode },
        select: { id: true },
      });
      resolvedRegionId = r?.id ?? null;
    }
    const company = await prisma.company.create({
      data: { ...rest, regionId: resolvedRegionId } as never,
    });
    set.status = 201;
    await logEvent({
      actorId: userId ?? null,
      action: 'COMPANY_CREATED',
      resourceType: 'company',
      resourceId: company.id,
      description: `Created company ${company.name}`,
      metadata: { name: company.name, status: company.status, regionId: resolvedRegionId },
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
      // Day 9: accept either id (preferred) or code. Either resolves to
      // the Region row at the application layer.
      regionId: t.Optional(t.String()),
      region: t.Optional(t.String()),
      customRegion: t.Optional(t.String()),
      creditLimit: t.Optional(t.Number()),
      paymentTerms: t.Optional(t.String()),
    }),
  })

  // Update company
  .patch('/:id', async ({ params, body, set, userId, request }) => {
    try {
      const data = body as Record<string, unknown>;
      // Same region-code → id resolution as the create handler.
      const { regionId, region: regionCode, ...rest } = data as {
        regionId?: string | null;
        region?: string | null;
      };
      let resolvedRegionId: string | null | undefined;
      if (regionId !== undefined) {
        resolvedRegionId = regionId; // explicit override (null clears it)
      } else if (regionCode !== undefined) {
        if (regionCode === null) {
          resolvedRegionId = null;
        } else {
          const r = await prisma.region.findFirst({
            where: { code: regionCode },
            select: { id: true },
          });
          resolvedRegionId = r?.id ?? null;
        }
      }
      const updateData = {
        ...rest,
        ...(resolvedRegionId !== undefined ? { regionId: resolvedRegionId } : {}),
      };
      const company = await prisma.company.update({
        where: { id: params.id },
        data: updateData as never,
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
