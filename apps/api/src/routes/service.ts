// @ts-nocheck — see rbac.ts for the Elysia 1.2 + TS 5.x d.ts trade-off
/**
 * Service catalogue routes
 *
 * Endpoints:
 *   GET    /services          - list services (with optional category filter)
 *   GET    /services/:id      - get single service with man-day lines
 *   POST   /services          - create service (with man-day lines)
 *   PATCH  /services/:id      - update service (replace man-day lines atomically)
 *   DELETE /services/:id      - delete service (only if no quotation items reference it)
 */

import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { requirePermission } from '../middleware/rbac';

export const serviceRoutes = new Elysia({ prefix: '/services', tags: ['services'] })
  .use(authContext)
  .use(requirePermission('service:read'))

  .get('/', async ({ query }) => {
    const { category, status, limit = '50', offset = '0' } = query as {
      category?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (status) where.status = status;
    const items = await prisma.service.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      // Match the detail endpoint so the frontend can render man-day
      // counts on the list page without an extra roundtrip.
      include: { manDayLines: { orderBy: { sortOrder: 'asc' } } },
    });
    return { items, total: items.length };
  })

  .get('/:id', async ({ params, set }) => {
    const service = await prisma.service.findUnique({
      where: { id: params.id },
      include: { manDayLines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!service) { set.status = 404; return { error: 'Service not found' }; }
    return service;
  })

  .post('/', async ({ body, set, userId, request }) => {
    const data = body as {
      name: string;
      description?: string;
      category?: string;
      unitPrice: number;
      currency?: string;
      status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
      sortOrder?: number;
      manDayLines?: Array<{ role: string; dayRate: number; days: number; sortOrder?: number }>;
    };
    const service = await prisma.service.create({
      data: {
        name: data.name,
        description: data.description,
        category: data.category,
        unitPrice: data.unitPrice,
        currency: data.currency ?? 'HKD',
        status: data.status ?? 'ACTIVE',
        sortOrder: data.sortOrder ?? 0,
        manDayLines: {
          create: (data.manDayLines ?? []).map((line) => ({
            role: line.role,
            dayRate: line.dayRate,
            days: line.days,
            subtotal: Number(line.dayRate) * Number(line.days),
            sortOrder: line.sortOrder ?? 0,
          })),
        },
      },
      include: { manDayLines: true },
    });
    set.status = 201;
    await logEvent({
      actorId: userId ?? null,
      action: 'SERVICE_CREATED',
      resourceType: 'service',
      resourceId: service.id,
      description: `Created service ${service.name} (unitPrice ${service.unitPrice})`,
      metadata: { name: service.name, manDayCount: service.manDayLines.length },
      request,
    });
    return service;
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 200 }),
      description: t.Optional(t.String()),
      category: t.Optional(t.String()),
      unitPrice: t.Number(),
      currency: t.Optional(t.String()),
      status: t.Optional(t.Union([t.Literal('ACTIVE'), t.Literal('ARCHIVED'), t.Literal('DRAFT')])),
      sortOrder: t.Optional(t.Number()),
      manDayLines: t.Optional(t.Array(t.Object({
        role: t.String({ minLength: 1 }),
        dayRate: t.Number(),
        days: t.Number(),
        sortOrder: t.Optional(t.Number()),
      }))),
    }),
  })

  .patch('/:id', async ({ params, body, set, userId, request }) => {
    const data = body as Partial<{
      name: string;
      description: string | null;
      category: string | null;
      unitPrice: number;
      currency: string;
      status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
      sortOrder: number;
      manDayLines: Array<{ role: string; dayRate: number; days: number; sortOrder?: number }>;
    }>;
    const before = await prisma.service.findUnique({ where: { id: params.id }, include: { manDayLines: true } });
    if (!before) { set.status = 404; return { error: 'Service not found' }; }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.service.update({
        where: { id: params.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.unitPrice !== undefined ? { unitPrice: data.unitPrice } : {}),
          ...(data.currency !== undefined ? { currency: data.currency } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        },
      });
      if (data.manDayLines) {
        await tx.serviceManDay.deleteMany({ where: { serviceId: params.id } });
        if (data.manDayLines.length > 0) {
          await tx.serviceManDay.createMany({
            data: data.manDayLines.map((line) => ({
              serviceId: params.id,
              role: line.role,
              dayRate: line.dayRate,
              days: line.days,
              subtotal: Number(line.dayRate) * Number(line.days),
              sortOrder: line.sortOrder ?? 0,
            })),
          });
        }
      }
      return result;
    });
    const full = await prisma.service.findUnique({
      where: { id: params.id },
      include: { manDayLines: { orderBy: { sortOrder: 'asc' } } },
    });
    await logEvent({
      actorId: userId ?? null,
      action: 'SERVICE_UPDATED',
      resourceType: 'service',
      resourceId: params.id,
      description: `Updated service ${updated.name}`,
      metadata: { name: updated.name, fields: Object.keys(data) },
      request,
    });
    return full;
  })

  .delete('/:id', async ({ params, userId, request }) => {
    const before = await prisma.service.findUnique({ where: { id: params.id }, select: { name: true } });
    if (!before) return { success: false };
    // Refuse delete if a quotation item references this service
    const usage = await prisma.quotationItem.count({ where: { serviceId: params.id } });
    if (usage > 0) {
      return { success: false, error: `Cannot delete: ${usage} quotation item(s) reference this service. Archive it instead.` };
    }
    await prisma.service.delete({ where: { id: params.id } });
    await logEvent({
      actorId: userId ?? null,
      action: 'SERVICE_DELETED',
      resourceType: 'service',
      resourceId: params.id,
      description: `Deleted service ${before.name}`,
      metadata: { name: before.name },
      request,
    });
    return { success: true };
  });
