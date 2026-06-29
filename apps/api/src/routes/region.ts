/**
 * Region routes — Day 9
 *
 * The Region table is now the source of truth for the company's primary
 * market segmentation. Frontend fetches this on app load and uses the
 * resulting list to render filter pills and the company-form region
 * dropdown. Admins can POST/PATCH/DELETE regions to extend the catalogue
 * (e.g. add Taiwan, Singapore) without a DDL migration.
 *
 * Note: Deleting a region that's referenced by companies is blocked at
 * the application layer — we set the FK to null on those companies
 * (via `onDelete: SetNull`) but the region row itself is removed. A
 * real product would prompt for reassignment first; for now we soft-check
 * the count and 409 if there are still references.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { requirePermission } from '../middleware/rbac';
import { logEvent } from '../middleware/audit';

export const regionRoutes = new Elysia({ prefix: '/regions', tags: ['regions'] })
  .use(authContext)
  // Reads are gated by `region:read` (any authenticated user with
  // the role's permission — SALES and VIEWER both get it). The
  // public-reads claim in the original comment is wrong: the
  // /regions GETs return through the same authContext.requirePermission
  // chain as the rest of the API, so an unauthenticated client gets
  // 401. The "public" was referring to the fact that region:read
  // is in VIEWER's default set, not that the route is anonymous.
  .use(requirePermission('region:read'))
  .get('/', async () => {
    return prisma.region.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { companies: true } } },
    });
  })
  .get('/:id', async ({ params, set }) => {
    const r = await prisma.region.findUnique({
      where: { id: params.id },
      include: { _count: { select: { companies: true } } },
    });
    if (!r) { set.status = 404; return { error: 'Region not found' }; }
    return r;
  })
  // Admin-only mutations.
  .use(requirePermission('region:create'))
  .post('/', async ({ body, set, userId, request }) => {
    const data = body as { code: string; name: string; flag?: string; sortOrder?: number };
    const r = await prisma.region.create({ data });
    await logEvent({
      actorId: userId ?? null,
      action: 'REGION_CREATED',
      resourceType: 'region',
      resourceId: r.id,
      description: `Created region ${r.code} (${r.name})`,
      request,
    });
    set.status = 201;
    return r;
  }, {
    body: t.Object({
      code: t.String({ minLength: 1, maxLength: 16 }),
      name: t.String({ minLength: 1 }),
      flag: t.Optional(t.String()),
      sortOrder: t.Optional(t.Number()),
    }),
  })
  .use(requirePermission('region:update'))
  .patch('/:id', async ({ params, body, set, userId, request }) => {
    const data = body as Partial<{ name: string; flag: string; isActive: boolean; sortOrder: number }>;
    const r = await prisma.region.update({ where: { id: params.id }, data });
    await logEvent({
      actorId: userId ?? null,
      action: 'REGION_UPDATED',
      resourceType: 'region',
      resourceId: r.id,
      description: `Updated region ${r.code}`,
      request,
    });
    return r;
  })
  .use(requirePermission('region:delete'))
  .delete('/:id', async ({ params, set, userId, request }) => {
    const refs = await prisma.company.count({ where: { regionId: params.id } });
    if (refs > 0) {
      set.status = 409;
      return { error: `Region is referenced by ${refs} company/companies`, referencedCount: refs };
    }
    await prisma.region.delete({ where: { id: params.id } });
    await logEvent({
      actorId: userId ?? null,
      action: 'REGION_DELETED',
      resourceType: 'region',
      resourceId: params.id,
      description: `Deleted region ${params.id}`,
      request,
    });
    return { success: true };
  });
