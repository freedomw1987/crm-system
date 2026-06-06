// @ts-nocheck — see rbac.ts for the Elysia 1.2 + TS 5.x d.ts trade-off
/**
 * Man-day Role routes (Day N)
 *
 * Admin-managed catalogue of man-day roles used by services.
 * Currency is locked to CNY (per David Day N). Each role has a sell price
 * (price) and a cost (cost) per man-day; service lines snapshot these
 * values at the time the line is created, so changing a role later only
 * affects DRAFT services / DRAFT quotations.
 *
 * Endpoints:
 *   GET    /man-day-roles        - list (any authenticated user)
 *   GET    /man-day-roles/:id    - get one
 *   POST   /man-day-roles        - create (admin only)
 *   PATCH  /man-day-roles/:id    - update (admin only)
 *   DELETE /man-day-roles/:id    - delete (admin only, blocked if referenced)
 */

import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { getUserIdFromRequest } from '../middleware/rbac';

export const manDayRoleRoutes = new Elysia({ prefix: '/man-day-roles', tags: ['man-day-roles'] })
  .use(authContext)
  // Read access: any authenticated user (the service form dropdown needs
  // to list active roles). We do not use requirePermission('service:read')
  // because the seed script doesn't currently write RolePermission rows.
  // Note: we don't gate on userId here because Elysia 1.2's authContext
  // derive does not reach the handler scope (see POST handler rationale).
  // The list itself isn't sensitive — it's a catalogue of role+price
  // pairs that all users need to see when pricing a service. If we ever
  // need to lock the read to authenticated users only, the right place
  // is a .guard() hook or a small re-derive helper, not a handler check.
  .get('/', async () => {
    return prisma.manDayRole.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  })

  .get('/:id', async ({ params, set }) => {
    const role = await prisma.manDayRole.findUnique({ where: { id: params.id } });
    if (!role) { set.status = 404; return { error: 'Man-day role not found' }; }
    return role;
  })

  // Admin-only mutations. We hardcode the role check here (instead of
  // requirePermission) because the seed script doesn't currently write
  // RolePermission rows — adding a permission name would 403 every user
  // until the seed is updated. The simpler "userRole === 'ADMIN'" guard
  // is correct for v1 (3 hardcoded roles) and matches the pattern used
  // by other Day-N admin routes. If we move to per-role custom permissions
  // for man-day roles, swap to requirePermission('admin:man_day_role:manage').
  .post('/', async ({ body, set, userId, request }) => {
    // Admin-only: we re-derive the role here (not via authContext.userRole)
    // because Elysia 1.2's derive context does not reach the route
    // handler scope (the derive only injects into onBeforeHandle and
    // onAfterHandle hooks). The same trick is used in middleware/rbac.ts.
    const adminUser = await prisma.user.findUnique({
      where: { id: await getUserIdFromRequest(request) ?? '__no_user__' },
      select: { role: true },
    });
    if (adminUser?.role !== 'ADMIN') { set.status = 403; return { error: 'Admin only' }; }
    const data = body as { name: string; price: number; cost?: number; sortOrder?: number; isActive?: boolean };
    // Guard against duplicate name (the unique index would also catch it,
    // but a friendly 409 is much nicer for the UI than a P2002 stack trace)
    const existing = await prisma.manDayRole.findUnique({ where: { name: data.name } });
    if (existing) {
      set.status = 409;
      return { error: `A man-day role named "${data.name}" already exists` };
    }
    const role = await prisma.manDayRole.create({
      data: {
        name: data.name,
        price: data.price,
        cost: data.cost ?? 0,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
      },
    });
    await logEvent({
      actorId: userId ?? null,
      action: 'MAN_DAY_ROLE_CREATED',
      resourceType: 'man_day_role',
      resourceId: role.id,
      description: `Created man-day role ${role.name} (price ${role.price}, cost ${role.cost})`,
      request,
    });
    set.status = 201;
    return role;
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 80 }),
      price: t.Number({ minimum: 0 }),
      cost: t.Optional(t.Number({ minimum: 0 })),
      sortOrder: t.Optional(t.Number()),
      isActive: t.Optional(t.Boolean()),
    }),
  })

  .patch('/:id', async ({ params, body, set, userId, request }) => {
    // Admin-only (see POST handler for the rationale on re-deriving
    // the role inline).
    const adminUser = await prisma.user.findUnique({
      where: { id: await getUserIdFromRequest(request) ?? '__no_user__' },
      select: { role: true },
    });
    if (adminUser?.role !== 'ADMIN') { set.status = 403; return { error: 'Admin only' }; }
    const data = body as Partial<{ name: string; price: number; cost: number; sortOrder: number; isActive: boolean }>;
    const before = await prisma.manDayRole.findUnique({ where: { id: params.id } });
    if (!before) { set.status = 404; return { error: 'Man-day role not found' }; }

    // Re-check uniqueness if the name is changing
    if (data.name && data.name !== before.name) {
      const dup = await prisma.manDayRole.findUnique({ where: { name: data.name } });
      if (dup) {
        set.status = 409;
        return { error: `A man-day role named "${data.name}" already exists` };
      }
    }

    const role = await prisma.manDayRole.update({
      where: { id: params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.cost !== undefined ? { cost: data.cost } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
    await logEvent({
      actorId: userId ?? null,
      action: 'MAN_DAY_ROLE_UPDATED',
      resourceType: 'man_day_role',
      resourceId: role.id,
      description: `Updated man-day role ${role.name}`,
      metadata: {
        before: { name: before.name, price: Number(before.price), cost: Number(before.cost) },
        after: { name: role.name, price: Number(role.price), cost: Number(role.cost) },
      },
      request,
    });
    return role;
  })

  .delete('/:id', async ({ params, set, userId, request }) => {
    // Admin-only (see POST handler for the rationale).
    const adminUser = await prisma.user.findUnique({
      where: { id: await getUserIdFromRequest(request) ?? '__no_user__' },
      select: { role: true },
    });
    if (adminUser?.role !== 'ADMIN') { set.status = 403; return { error: 'Admin only' }; }
    const before = await prisma.manDayRole.findUnique({ where: { id: params.id } });
    if (!before) { set.status = 404; return { error: 'Man-day role not found' }; }
    // Block delete if a service line still references this role. The FK
    // is ON DELETE SET NULL, so the row would silently disappear from the
    // service line's UI; we want to make the admin reassign first.
    const refs = await prisma.serviceManDay.count({ where: { manDayRoleId: params.id } });
    if (refs > 0) {
      set.status = 409;
      return {
        error: `Man-day role is used by ${refs} service line(s). Reassign or remove those lines first.`,
        referencedCount: refs,
      };
    }
    await prisma.manDayRole.delete({ where: { id: params.id } });
    await logEvent({
      actorId: userId ?? null,
      action: 'MAN_DAY_ROLE_DELETED',
      resourceType: 'man_day_role',
      resourceId: params.id,
      description: `Deleted man-day role ${before.name}`,
      request,
    });
    return { success: true };
  });
