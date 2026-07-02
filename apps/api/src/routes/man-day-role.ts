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
import { requirePermission, getUserIdFromRequest } from '../middleware/rbac';
import { tApi } from '../lib/i18n';

export const manDayRoleRoutes = new Elysia({ prefix: '/man-day-roles', tags: ['man-day-roles'] })
  .use(authContext)
  // Reads are gated by `man-day-role:read` (any authenticated user with
  // the role's permission — SALES + VIEWER both get it via the system
  // role default set). The list is a catalogue of role+price pairs
  // needed by the service form's man-day breakdown editor.
  .use(requirePermission('man-day-role:read'))
  .get('/', async () => {
    return prisma.manDayRole.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  })

  .get('/:id', async ({ params, set, locale }) => {
    const role = await prisma.manDayRole.findUnique({ where: { id: params.id } });
    if (!role) { set.status = 404; return { error: tApi(locale, 'MAN_DAY_ROLE_NOT_FOUND') }; }
    return role;
  })

  // Admin-only mutations. Gated by `man-day-role:create|update|delete`
  // (ADMIN-only by default). The handler-internal userRole re-derive
  // was kept as defense-in-depth in case Elysia 1.2's requirePermission
  // doesn't reach the handler scope — see the rationale in PATCH below.
  .use(requirePermission('man-day-role:create'))
  .post('/', async ({ body, set, userId, request, locale }) => {
    // Admin-only: we re-derive the role here (not via authContext.userRole)
    // because Elysia 1.2's derive context does not reach the route
    // handler scope (the derive only injects into onBeforeHandle and
    // onAfterHandle hooks). The same trick is used in middleware/rbac.ts.
    const adminUser = await prisma.user.findUnique({
      where: { id: await getUserIdFromRequest(request) ?? '__no_user__' },
      select: { role: true },
    });
    if (adminUser?.role !== 'ADMIN') { set.status = 403; return { error: tApi(locale, 'ADMIN_ONLY') }; }
    const data = body as { name: string; price: number; cost?: number; sortOrder?: number; isActive?: boolean };
    // Guard against duplicate name (the unique index would also catch it,
    // but a friendly 409 is much nicer for the UI than a P2002 stack trace)
    const existing = await prisma.manDayRole.findUnique({ where: { name: data.name } });
    if (existing) {
      set.status = 409;
      return { error: tApi(locale, 'MAN_DAY_ROLE_NAME_EXISTS', { name: data.name }) };
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

  .use(requirePermission('man-day-role:update'))
  .patch('/:id', async ({ params, body, set, userId, request, locale }) => {
    // Admin-only (see POST handler for the rationale on re-deriving
    // the role inline).
    const adminUser = await prisma.user.findUnique({
      where: { id: await getUserIdFromRequest(request) ?? '__no_user__' },
      select: { role: true },
    });
    if (adminUser?.role !== 'ADMIN') { set.status = 403; return { error: tApi(locale, 'ADMIN_ONLY') }; }
    const data = body as Partial<{ name: string; price: number; cost: number; sortOrder: number; isActive: boolean }>;
    const before = await prisma.manDayRole.findUnique({ where: { id: params.id } });
    if (!before) { set.status = 404; return { error: tApi(locale, 'MAN_DAY_ROLE_NOT_FOUND') }; }

    // Re-check uniqueness if the name is changing
    if (data.name && data.name !== before.name) {
      const dup = await prisma.manDayRole.findUnique({ where: { name: data.name } });
      if (dup) {
        set.status = 409;
        return { error: tApi(locale, 'MAN_DAY_ROLE_NAME_EXISTS', { name: data.name }) };
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

  .use(requirePermission('man-day-role:delete'))
  .delete('/:id', async ({ params, set, userId, request, locale }) => {
    // Admin-only (see POST handler for the rationale).
    const adminUser = await prisma.user.findUnique({
      where: { id: await getUserIdFromRequest(request) ?? '__no_user__' },
      select: { role: true },
    });
    if (adminUser?.role !== 'ADMIN') { set.status = 403; return { error: tApi(locale, 'ADMIN_ONLY') }; }
    const before = await prisma.manDayRole.findUnique({ where: { id: params.id } });
    if (!before) { set.status = 404; return { error: tApi(locale, 'MAN_DAY_ROLE_NOT_FOUND') }; }
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
