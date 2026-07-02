import { Elysia } from 'elysia';
import { prisma } from '@crm/db';
import { logEvent } from '../middleware/audit';
import { authContext } from '../lib/context';
import { requirePermission } from '../middleware/rbac';
import { withAuditDelete } from '../lib/with-audit';
import { tApi } from '../lib/i18n';

// P0-2 (2026-06-07 review): all 4 contact endpoints (GET list/detail,
// POST, PATCH, DELETE) were public. Now gated.
export const contactRoutes = new Elysia({ prefix: '/contacts', tags: ['contacts'] })
  .use(authContext)
  .use(requirePermission('contact:read'))
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
  .use(requirePermission('contact:read'))
  .get('/:id', async ({ params, set, locale }) => {
    const c = await prisma.contact.findUnique({
      where: { id: params.id },
      // P1-1 (2026-06-08): drop `activities` from the include. The
      // Prisma model has no direct Activity relation (see the comment
      // block in schema.prisma: "activities are attached at the
      // Company or Deal level only"). The previous code was a latent
      // typecheck error masked by `@ts-nocheck`; in production it
      // would have crashed the first time a Contact detail page
      // was opened. Activity lookups should go through the parent
      // Company (via `?companyId=` filter) or Deal instead.
      include: { company: true, addresses: true },
    });
    if (!c) { set.status = 404; return { error: tApi(locale, 'CONTACT_NOT_FOUND') }; }
    return c;
  })
  .use(requirePermission('contact:create'))
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
  .use(requirePermission('contact:update'))
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
  .use(requirePermission('contact:delete'))
  .delete('/:id', async ({ params, userId, request }) => {
    const before = await prisma.contact.findUnique({ where: { id: params.id }, select: { firstName: true, lastName: true } });
    if (!before) return { success: true };
    return withAuditDelete({
      action: 'CONTACT_DELETED',
      resourceType: 'contact',
      resourceId: params.id,
      userId,
      request,
      deleteFn: () => prisma.contact.delete({ where: { id: params.id } }),
      label: `${before.firstName} ${before.lastName}`,
    });
  });
