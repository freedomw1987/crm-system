import { Elysia, t } from 'elysia';
import { Prisma } from '@crm/db';
import { prisma } from '@crm/db';
import { getCurrencyConfig } from '@crm/db';
import { logEvent } from '../middleware/audit';
import { authContext } from '../lib/context';
import { requirePermission, getUserIdFromRequest } from '../middleware/rbac';
import { withAuditDelete } from '../lib/with-audit';

// P0-2 (2026-06-07 review): all deal endpoints (GET list/kanban/:id,
// POST, PATCH stage, PATCH, DELETE) were public. Now gated.

import { toIdArray } from '../lib/query-helpers';

export const dealRoutes = new Elysia({ prefix: '/deals', tags: ['deals'] })
  .use(authContext)
  .use(requirePermission('deal:read'))
  // List deals (flat)
  .get('/', async ({ query }) => {
    // 2026-06-09: accept comma-separated `ownerIds` / `companyIds` /
    // `ownerId` / `companyId` so the Deals + Quotation pages can do
    // multi-select filtering. The two shapes are kept in sync so old
    // callers passing a single id still work.
    const {
      ownerId, stageId, status, companyId,
      ownerIds, companyIds,
      limit = '50', offset = '0',
    } = query as {
      ownerId?: string;
      stageId?: string;
      status?: string;
      companyId?: string;
      ownerIds?: string | string[];
      companyIds?: string | string[];
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    // Single-id shorthand (back-compat with the previous API surface)
    if (ownerId) where.ownerId = ownerId;
    if (companyId) where.companyId = companyId;
    // Multi-id: parse `?ownerIds=a&ownerIds=b` (Elysia delivers this as
    // an array) and `?ownerIds=a,b` (single comma-separated string) into
    // a uniform array. Empty / missing means "no filter".
    if (ownerIds) {
      const ids = toIdArray(ownerIds);
      if (ids.length) where.ownerId = { in: ids };
    }
    if (companyIds) {
      const ids = toIdArray(companyIds);
      if (ids.length) where.companyId = { in: ids };
    }
    if (stageId) where.stageId = stageId;
    if (status) where.status = status;
    return prisma.deal.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true, region: { select: { id: true, code: true, name: true, flag: true } } } },
        owner: { select: { id: true, name: true, email: true } },
        stage: { select: { id: true, name: true, probability: true, color: true } },
        _count: { select: { quotations: true } },
      },
    });
  })

  // Day 8: Kanban view — returns stages with nested deals, perfect for drag-drop board
  .use(requirePermission('deal:read'))
  .get('/kanban', async ({ query }) => {
    // 2026-06-09: same multi-select filter as the flat /deals list.
    // `?companyIds=a,b` or `?companyIds=a&companyIds=b` (and same for
    // ownerIds) all work. Single-id shorthand `companyId` / `ownerId`
    // is kept for back-compat.
    const { ownerId, pipelineId, companyId, ownerIds, companyIds } = query as {
      ownerId?: string;
      pipelineId?: string;
      companyId?: string;
      ownerIds?: string | string[];
      companyIds?: string | string[];
    };
    // 1) pick the pipeline (default if not specified)
    const pipeline = pipelineId
      ? await prisma.pipeline.findUnique({ where: { id: pipelineId } })
      : await prisma.pipeline.findFirst({ where: { isDefault: true } });
    if (!pipeline) return { error: 'No pipeline found' };
    // 2) load stages
    const stages = await prisma.pipelineStage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { position: 'asc' },
    });
    // 3) load all deals in one query, then bucket by stage
    const where: Record<string, unknown> = { pipelineId: pipeline.id };
    if (ownerId) where.ownerId = ownerId;
    if (companyId) where.companyId = companyId;
    if (ownerIds) {
      const ids = toIdArray(ownerIds);
      if (ids.length) where.ownerId = { in: ids };
    }
    if (companyIds) {
      const ids = toIdArray(companyIds);
      if (ids.length) where.companyId = { in: ids };
    }
    const deals = await prisma.deal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true, region: { select: { id: true, code: true, name: true, flag: true } } } },
        owner: { select: { id: true, name: true, email: true } },
        // Day 9: include stage so the frontend edit dialog can pre-select
        // the deal's current stage. Without this, `deal.stage` arrives as
        // `undefined` and the form falls back to `stages[0]` (Lead),
        // making every deal LOOK like a Lead no matter where it sits on
        // the Kanban board.
        stage: { select: { id: true, name: true, probability: true, color: true } },
        _count: { select: { quotations: true } },
      },
    });
    // 4) bucket — preserve stage order, include empty stages as []
    const buckets = stages.map((s) => ({
      stage: s,
      deals: deals.filter((d) => d.stageId === s.id),
    }));
    return { pipeline, buckets };
  })

  // Day 8: Move deal to a different stage (Kanban drag-drop endpoint)
  .use(requirePermission('deal:update'))
  .patch('/:id/stage', async ({ params, body, userId, request }) => {
    const { stageId, status } = body as { stageId: string; status?: 'OPEN' | 'WON' | 'LOST' };
    // Verify the new stage exists
    const newStage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
    if (!newStage) return { error: 'Stage not found' };
    // Auto-set status: Won stage → WON, Lost stage → LOST, others → OPEN
    let finalStatus = status;
    if (!finalStatus) {
      if (newStage.name === 'Won') finalStatus = 'WON';
      else if (newStage.name === 'Lost') finalStatus = 'LOST';
      else finalStatus = 'OPEN';
    }
    const updated = await prisma.deal.update({
      where: { id: params.id },
      data: {
        stageId,
        status: finalStatus,
        // If moving to Won/Lost, stamp closedAt
        closedAt: finalStatus !== 'OPEN' ? new Date() : null,
      },
      include: { stage: true },
    });
    await logEvent({
      actorId: userId ?? null,
      action: 'DEAL_STAGE_CHANGED',
      resourceType: 'deal',
      resourceId: params.id,
      description: `Moved deal ${updated.title} to ${newStage.name}`,
      metadata: { stage: newStage.name, status: finalStatus },
      request,
    });
    return updated;
  }, {
    body: t.Object({
      stageId: t.String(),
      status: t.Optional(t.Union([t.Literal('OPEN'), t.Literal('WON'), t.Literal('LOST')])),
    }),
  })

  .use(requirePermission('deal:read'))
  .get('/:id', async ({ params, set }) => {
    const d = await prisma.deal.findUnique({
      where: { id: params.id },
      include: {
        company: true,
        owner: true,
        stage: true,
        pipeline: true,
        activities: { take: 30, orderBy: { createdAt: 'desc' } },
        quotations: { orderBy: { createdAt: 'desc' }, include: { company: { select: { id: true, name: true } } } },
      },
    });
    if (!d) { set.status = 404; return { error: 'Not found' }; }
    return d;
  })
  .use(requirePermission('deal:create'))
  .post('/', async ({ body, set, userId, request }) => {
    // RG-2026-06-07-DEAL-AUTOCOMPLETE: tightened body validation. Previously
    // we passed `body as never` straight into prisma.deal.create, so a
    // malformed payload (e.g. bogus `status` value, missing required FK,
    // wrong type for `value`) would either fail with an opaque Prisma
    // error or — worse — silently drop a field. The schema below mirrors
    // the Deal model in schema.prisma and ensures Quick-Create from the
    // QuotationBuilder's new DealAutocomplete always lands in a sane
    // state.
    //
    // We also have to translate the flat `companyId` / `stageId` /
    // `ownerId` / `pipelineId` foreign keys into the Prisma relation
    // connect shape. The Deal model declares `company Company @relation`
    // / `stage PipelineStage @relation` / etc., so Prisma will NOT
    // accept bare `companyId: "..."` — it requires either
    // `company: { connect: { id: "..." } }` or the
    // `CompanyCreateNestedOneWithoutDealsInput` wrapper. The old code
    // got away with `as never` because the cast lied to TypeScript, but
    // the runtime was always going to 500 on a flat payload.
    //
    // Owner defaulting: if the caller omits `ownerId`, fall back to
    // `userId` (the authenticated user). Sales reps will normally be
    // creating deals for themselves, so this matches the kanban-drag
    // flow's expectation.
    //
    // Pipeline defaulting: the Deal model requires a `pipelineId` AND
    // the stage must belong to that pipeline. We resolve the stage's
    // pipeline if the caller didn't supply `pipelineId` explicitly.
    const incoming = body as {
      title: string;
      companyId: string;
      stageId: string;
      value: number | string;
      ownerId?: string;
      pipelineId?: string;
      expectedCloseDate?: Date;
      description?: string;
      probability?: number | string;
      status?: 'OPEN' | 'WON' | 'LOST';
      // P2 multi-currency (2026-06-29): frontend may pass an explicit
      // currency (the picker default). Omitted → server falls back
      // to the admin-set system default via getCurrencyConfig().
      currency?: string;
    };
    // Resolve pipelineId from the stage if not supplied
    let pipelineId = incoming.pipelineId;
    if (!pipelineId) {
      const stage = await prisma.pipelineStage.findUnique({
        where: { id: incoming.stageId },
        select: { pipelineId: true },
      });
      if (!stage) { set.status = 400; return { error: `Stage ${incoming.stageId} not found` }; }
      pipelineId = stage.pipelineId;
    }
    // Owner defaults to the calling user
    // RG-2026-06-07-DEAL-AUTOCOMPLETE: in Elysia 1.2 the `userId`
    // derived by `authContext` is NOT reliably visible in route
    // handlers chained after `.use(requirePermission(...))` — the
    // RBAC middleware's own comment at rbac.ts:67-75 documents this.
    // We fall back to re-decoding the JWT from the request headers
    // via `getUserIdFromRequest` (the same helper RBAC uses internally)
    // so the ownerId default works in this route specifically.
    const ownerId = incoming.ownerId ?? userId ?? await getUserIdFromRequest(request);
    if (!ownerId) { set.status = 400; return { error: 'ownerId is required (no user in context)' }; }
    // P2 multi-currency (2026-06-29): default the deal's currency to
    // the admin-configured system default rather than the hardcoded
    // Prisma default. The frontend may also pass an explicit `currency`
    // (e.g. when the sales rep picked a non-default one); honour that
    // when present. We deliberately do NOT snapshot an exchange rate
    // here — Deal doesn't carry one (only Quotation does). Display
    // paths that sum across deals handle the mixed-currency caveat.
    const currencyCfg = await getCurrencyConfig();
    const dealCurrency = incoming.currency ?? currencyCfg.default;
    // RG-2026-06-07-DEAL-AUTOCOMPLETE: use the UncheckedCreateInput
    // shape (flat FK columns) so we can specify companyId / stageId /
    // pipelineId / ownerId as plain strings. The "checked" input type
    // requires `company: { connect: { id } }` instead, but you can't
    // mix the two — Prisma enforces one or the other. The Unchecked
    // shape is the right fit for a flat API payload like ours.
    const created = await prisma.deal.create({
      data: {
        title: incoming.title,
        value: new Prisma.Decimal(Number(incoming.value)),
        status: incoming.status ?? 'OPEN',
        currency: dealCurrency,
        ...(incoming.expectedCloseDate ? { expectedCloseDate: incoming.expectedCloseDate } : {}),
        ...(incoming.description ? { description: incoming.description } : {}),
        ...(incoming.probability != null ? { probability: new Prisma.Decimal(Number(incoming.probability)) } : {}),
        pipelineId,
        stageId: incoming.stageId,
        companyId: incoming.companyId,
        ownerId,
      } as Prisma.DealUncheckedCreateInput,
    });
    set.status = 201;
    // RG-2026-06-07-DEAL-AUTOCOMPLETE: same Elysia 1.2 userId-derive
    // caveat as above. Re-decode from headers so the audit entry
    // actually carries the creating user's id.
    const actorId = userId ?? await getUserIdFromRequest(request);
    await logEvent({
      actorId: actorId ?? null,
      action: 'DEAL_CREATED',
      resourceType: 'deal',
      resourceId: created.id,
      description: `Created deal ${created.title} (value ${created.value})`,
      metadata: { title: created.title, value: Number(created.value), status: created.status },
      request,
    });
    return created;
  }, {
    body: t.Object({
      title: t.String({ minLength: 1, maxLength: 200 }),
      companyId: t.String({ minLength: 1 }),
      stageId: t.String({ minLength: 1 }),
      value: t.Numeric(), // accepts number OR numeric string ("0", "1234.56")
      // Optional fields commonly filled in by the QuotationBuilder's
      // Quick-Create dialog. Anything else (description, status,
      // probability, lostReason, aiInsights, closedAt) is
      // server-side defaulted so the Quick-Create flow doesn't have to
      // care about them. `currency` is now exposed (2026-06-29):
      // defaults to the admin's system currency at request time
      // when omitted, rather than the hardcoded Prisma default.
      expectedCloseDate: t.Optional(t.Date()),
      pipelineId: t.Optional(t.String()),
      ownerId: t.Optional(t.String()),
      description: t.Optional(t.String({ maxLength: 5000 })),
      probability: t.Optional(t.Numeric()),
      status: t.Optional(t.Union([t.Literal('OPEN'), t.Literal('WON'), t.Literal('LOST')])),
      currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
    }),
  })
  .use(requirePermission('deal:update'))
  .patch('/:id', async ({ params, body, userId, request }) => {
    // RG-2026-06-07-DEAL-AUTOCOMPLETE: PATCH body is now a Partial<> of the
    // POST schema so callers can update individual fields without
    // re-sending the full record. Unknown fields are rejected at the
    // validation layer instead of silently dropped by Prisma.
    const updated = await prisma.deal.update({ where: { id: params.id }, data: body as never });
    await logEvent({
      actorId: userId ?? null,
      action: 'DEAL_UPDATED',
      resourceType: 'deal',
      resourceId: params.id,
      description: `Updated deal ${updated.title}`,
      metadata: { title: updated.title, fields: Object.keys(body as object) },
      request,
    });
    return updated;
  }, {
    body: t.Object({
      title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      value: t.Optional(t.Numeric()),
      expectedCloseDate: t.Optional(t.Date()),
      description: t.Optional(t.String({ maxLength: 5000 })),
      probability: t.Optional(t.Numeric()),
      // 2026-06-26: ownerId is now editable via PATCH. The frontend
      // DealDialog exposes a 銷售員 picker; on save it sends the
      // picked user id. Coerce empty string to null so a cleared
      // autocomplete removes the FK (matching the dealId /
      // salesRepId semantics in quotation.ts). We don't apply the
      // SENT-style lock here because deals don't have a
      // contractual-state concept — owner reassignment is always
      // permitted (e.g. when a sales rep leaves the company).
      ownerId: t.Optional(t.Union([t.String(), t.Null()])),
      // P2 multi-currency (2026-06-29): sales rep can change a deal's
      // billing currency post-creation. The frontend picker only offers
      // RMB/HKD/MOP (the three system currencies); backend trusts
      // whatever string the client sends. Free-form `string` instead of
      // an enum keeps the schema in sync with Product / Service, which
      // also accept legacy USD/EUR/GBP entries.
      currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
      // Stage is intentionally NOT in PATCH body: stage changes go
      // through the dedicated /:id/stage endpoint so the backend can
      // set status + closedAt correctly.
    }),
  })
  .use(requirePermission('deal:delete'))
  .delete('/:id', async ({ params, userId, request }) => {
    const before = await prisma.deal.findUnique({ where: { id: params.id }, select: { title: true } });
    if (!before) return { success: true };
    return withAuditDelete({
      action: 'DEAL_DELETED',
      resourceType: 'deal',
      resourceId: params.id,
      userId,
      request,
      deleteFn: () => prisma.deal.delete({ where: { id: params.id } }),
      extraMetadata: { title: before.title },
    });
  });
