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
 *
 * Day N: man-day lines now have an optional `manDayRoleId`. When provided,
 * the server snapshots the role's current name, price, and cost into the
 * ServiceManDay row. The line is therefore stable even if the admin later
 * edits the role — a feature David specifically asked for ("lock the price
 * once a service is configured"). DRAFT services still pick up the latest
 * rate on rebuild because the rebuild re-snapshots from the live ManDayRole.
 *
 * For legacy clients that still send `role` + `dayRate` without
 * `manDayRoleId`, the server treats the line as free-form (manDayRoleId
 * stays null, role/dayRate are stored as-is). This keeps the new feature
 * additive.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { requirePermission } from '../middleware/rbac';
// 2026-07-01 (US-IMPORT-MD): shared with the AI Excel import executor
// (`apps/api/src/lib/excel-import.ts`). Both POST/PATCH here and
// `executeImportPlan` need the same role-resolution logic for the
// new SENT ManDayRole catalogue vs free-form snapshot.
import { snapshotManDayLine, buildRoleLookup } from '../lib/man-day-snapshot';

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
      manDayLines?: Array<{
        manDayRoleId?: string;
        role?: string;
        dayRate?: number;
        costRate?: number;
        days: number;
        sortOrder?: number;
      }>;
    };
    const roleIds = (data.manDayLines ?? [])
      .map((l) => l.manDayRoleId)
      .filter((id): id is string => Boolean(id));
    const roleLookup = await buildRoleLookup(prisma, roleIds);
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
          create: (data.manDayLines ?? []).map((line) => snapshotManDayLine(line, roleLookup)),
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
        // New: pick from the ManDayRole catalogue
        manDayRoleId: t.Optional(t.String()),
        // Legacy free-form fields (kept for back-compat with v1 clients)
        role: t.Optional(t.String({ minLength: 1 })),
        dayRate: t.Optional(t.Number()),
        costRate: t.Optional(t.Number()),
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
      manDayLines: Array<{
        manDayRoleId?: string;
        role?: string;
        dayRate?: number;
        costRate?: number;
        days: number;
        sortOrder?: number;
      }>;
    }>;
    const before = await prisma.service.findUnique({ where: { id: params.id }, include: { manDayLines: true } });
    if (!before) { set.status = 404; return { error: 'Service not found' }; }

    const roleIds = (data.manDayLines ?? [])
      .map((l) => l.manDayRoleId)
      .filter((id): id is string => Boolean(id));
    const roleLookup = await buildRoleLookup(prisma, roleIds);

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
              ...snapshotManDayLine(line, roleLookup),
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
    return withAuditDelete({
      action: 'SERVICE_DELETED',
      resourceType: 'service',
      resourceId: params.id,
      userId,
      request,
      deleteFn: () => prisma.service.delete({ where: { id: params.id } }),
      label: before.name,
    });
  });
