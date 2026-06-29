// @ts-nocheck — see rbac.ts for the Elysia 1.2 + TS 5.x d.ts trade-off
import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { toIdArray } from '../lib/query-helpers';
// 2026-06-07 (US-A5): port 落 CRM 嘅 Excel 5-sheet generator + Prisma adapter
import { adaptCrmQuotationForExcel } from '../lib/excel/crm-adapter';
import { generateQuotationExcel } from '../lib/excel/quotation';
// P2 multi-currency (2026-06-29): getCurrencyConfig / hkdRateFor live
// in @crm/db so this route + the AI draft_quotation tool share one
// source of truth (see packages/db/src/currency.ts).
import { getCurrencyConfig, hkdRateFor } from '@crm/db';

// Quotation number generator (Q-YYYY-NNNN)
async function nextQuotationNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `Q-${year}-`;
  const last = await prisma.quotation.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
  });
  const lastSeq = last ? parseInt(last.number.slice(prefix.length), 10) : 0;
  const next = (lastSeq + 1).toString().padStart(4, '0');
  return `${prefix}${next}`;
}

/**
 * Compute the next revision's number and revisionNumber.
 *
 * 2026-06-26: POST /quotations/:id/revise creates a new DRAFT
 * quotation cloned from a non-DRAFT source. This helper picks the
 * next position in the chain so the revision tree is reproducible:
 *
 *   Q-2026-0001          (root, revisionNumber=0)
 *     └─ Q-2026-0001-R1   (parent=root, revisionNumber=1)
 *          └─ Q-2026-0001-R2 (parent=R1, revisionNumber=2)
 *
 * Algorithm:
 *   1. Walk the parentQuotationId chain from `parentId` upward
 *      until we hit a quotation with no parent (the root).
 *   2. BFS down from the root via parentQuotationId to count every
 *      descendant (handles branching: even if someone revised from
 *      an old version mid-chain, we still get a unique next
 *      revisionNumber).
 *   3. The new revision's position = count (root is position 0,
 *      R1 is position 1, etc.).
 *   4. The new number preserves the root number and appends the
 *      suffix: `${root.number}-R${count}`. If the new revision
 *      turns out to clash with an existing number (shouldn't
 *      happen given the BFS uniqueness invariant, but defensive),
 *      the @unique constraint on Quotation.number will surface a
 *      500 — acceptable for v1 since the invariant holds in
 *      practice.
 */
async function nextRevisionInfo(parentId: string): Promise<{ number: string; revisionNumber: number }> {
  // 1. Walk to root
  let cursorId: string = parentId;
  let rootId: string | null = null;
  while (true) {
    const q = await prisma.quotation.findUnique({
      where: { id: cursorId },
      select: { parentQuotationId: true },
    });
    if (!q) break;
    rootId = cursorId;
    if (q.parentQuotationId === null) break;
    cursorId = q.parentQuotationId;
  }
  if (!rootId) throw new Error('Could not find root quotation in chain');

  const root = await prisma.quotation.findUnique({
    where: { id: rootId },
    select: { number: true },
  });
  if (!root) throw new Error('Root quotation not found');

  // 2. BFS down from root to count every descendant.
  let count = 0;
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    count++;
    const children = await prisma.quotation.findMany({
      where: { parentQuotationId: id },
      select: { id: true },
    });
    for (const c of children) queue.push(c.id);
  }

  // 3 + 4. Compose the new revision metadata.
  // count = number of quotations currently in the chain (1 for root
  // only, 2 for root+R1, 3 for root+R1+R2, etc.). The new
  // revision will sit at position count in 0-indexed terms
  // because the root occupies position 0, R1 occupies position 1,
  // etc. So newRevisionNumber = count.
  const revisionNumber = count;
  const number = `${root.number}-R${revisionNumber}`;
  return { number, revisionNumber };
}

// Compute line total for an item
function lineTotalOf(qty: number, price: number, disc: number) {
  return qty * price * (1 - disc / 100);
}

// GP% + SOW helpers are extracted into `lib/quotation-gp.ts` so they
// can be unit-tested without spinning up the Elysia app / Prisma
// (US-A3 follow-up, 2026-06-08). Re-import here to keep all
// existing call sites working without behavioural change.
import { gpOf, costPerManDayFromSnapshot } from '../lib/quotation-gp';



/**
 * Recalculate every line item's GP fields and the header subtotal/tax/
 * total. Call this after any change to line items or to a service's
 * man-day role costs (only on DRAFT quotations — SENT quotations keep
 * their snapshot).
 */
async function recalcQuotationAndItems(quotationId: string, opts: { liveCostRefresh?: boolean } = {}) {
  const items = await prisma.quotationItem.findMany({ where: { quotationId } });
  const q = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!q) return null;

  // For each line, compute costSnapshot and line GP. For SERVICE lines
  // we pull the latest cost from either the snapshot (default) or from
  // the live ManDayRole (if liveCostRefresh=true and the service is
  // still attached).
  for (const it of items) {
    let costPerManDay = 0;
    if (it.itemType === 'SERVICE') {
      if (opts.liveCostRefresh && it.serviceId) {
        // Look up the current ServiceManDay lines to recompute cost
        const live = await prisma.serviceManDay.findMany({ where: { serviceId: it.serviceId } });
        if (live.length > 0) {
          const totalCost = live.reduce((s, l) => s + Number(l.costRate) * Number(l.days), 0);
          const totalDays = live.reduce((s, l) => s + Number(l.days), 0);
          costPerManDay = totalDays > 0 ? totalCost / totalDays : 0;
        } else {
          costPerManDay = costPerManDayFromSnapshot(it.manDaySnapshot);
        }
      } else {
        costPerManDay = costPerManDayFromSnapshot(it.manDaySnapshot);
      }
    }
    const costSnapshot = costPerManDay * Number(it.quantity);
    const { lineGp, lineGpPercent } = gpOf(it.itemType, Number(it.lineTotal), costSnapshot);
    await prisma.quotationItem.update({
      where: { id: it.id },
      data: { costSnapshot, lineGp, lineGpPercent },
    });
  }
  // Refresh item list to get the just-updated GP fields
  const updatedItems = await prisma.quotationItem.findMany({ where: { quotationId } });
  const subtotal = updatedItems.reduce((s, it) => s + Number(it.lineTotal), 0);
  const taxAmount = subtotal * (Number(q.taxRate) / 100);
  const total = subtotal + taxAmount;
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { subtotal, taxAmount, total },
  });
  return { subtotal, taxAmount, total };
}

/**
 * Returns the snapshot costPerManDay for a service line. The frontend
 * may pass a manDaySnapshot in the create/patch body; if missing, we
 * pull the current ServiceManDay lines (DRAFT behaviour) or stay at 0
 * (SENT behaviour — there's nothing to live-refresh anymore).
 */
async function resolveServiceCostSnapshot(
  serviceId: string | null | undefined,
  manDaySnapshot: unknown,
  isDraft: boolean,
): Promise<number> {
  if (!serviceId) return costPerManDayFromSnapshot(manDaySnapshot);
  if (isDraft) {
    const live = await prisma.serviceManDay.findMany({ where: { serviceId } });
    if (live.length > 0) {
      const totalCost = live.reduce((s, l) => s + Number(l.costRate) * Number(l.days), 0);
      const totalDays = live.reduce((s, l) => s + Number(l.days), 0);
      return totalDays > 0 ? totalCost / totalDays : 0;
    }
  }
  return costPerManDayFromSnapshot(manDaySnapshot);
}

export const quotationRoutes = new Elysia({ prefix: '/quotations', tags: ['quotations'] })
  .use(authContext)
  .get('/', async ({ query }) => {
    // 2026-06-09: multi-select filter for the Quotation list page.
    // Accepts `companyIds` / `createdByIds` (array or comma-separated
    // string) in addition to the existing single-id `companyId` /
    // `createdById`. `createdById` is the "sales rep" for a quotation
    // — there is no `ownerId` column on `Quotation`; whoever created
    // the quote is treated as the sales rep.
    const {
      companyId, status, createdById, dealId,
      companyIds, createdByIds,
      limit = '50', offset = '0',
    } = query as {
      companyId?: string;
      status?: string;
      createdById?: string;
      dealId?: string;
      companyIds?: string | string[];
      createdByIds?: string | string[];
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (createdById) where.createdById = createdById;
    if (dealId) where.dealId = dealId;
    if (companyIds) {
      const ids = toIdArray(query.companyIds as string | string[] | undefined);
      if (ids.length) where.companyId = { in: ids };
    }
    if (createdByIds) {
      const ids = toIdArray(query.createdByIds as string | string[] | undefined);
      if (ids.length) where.createdById = { in: ids };
    }
    return prisma.quotation.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        // 2026-06-26: include salesRep so the list page can render
        // the salesperson column without an extra roundtrip.
        // Nullable in the schema; fall back to createdBy on the
        // frontend when null.
        salesRep: { select: { id: true, name: true, email: true } },
        deal: { select: { id: true, title: true, stage: { select: { name: true, color: true } } } },
        _count: { select: { items: true } },
      },
    });
  })
  .get('/:id', async ({ params, set }) => {
    const q = await prisma.quotation.findUnique({
      where: { id: params.id },
      include: {
        company: true,
        createdBy: { select: { id: true, name: true, email: true } },
        // 2026-06-26: detail response also carries salesRep.
        salesRep: { select: { id: true, name: true, email: true } },
        deal: { select: { id: true, title: true, stage: { select: { name: true, color: true } } } },
        items: { include: { product: true, service: { include: { manDayLines: true } } }, orderBy: { position: 'asc' } },
      },
    });
    if (!q) { set.status = 404; return { error: 'Not found' }; }
    return q;
  })
  // 2026-06-07 (US-A5): Download Quotation as .xlsx (5 worksheets, bc-quotation
  // format). GET /api/quotations/:id/export-xlsx?lang=zh&version=v2
  // Returns binary xlsx with filename = quotation.number (e.g., Q-2026-0001.xlsx).
  // Any authenticated user with read access to the quotation can download —
  // no extra permission gate, since GET /:id is also open to authenticated
  // users. (RBAC 係 sales rep 同 admin 已經有 read, sales rep 下屬之間 read
  // 嘅 scope 跟現有 GET /:id 嘅 include 邏輯。)
  .get('/:id/export-xlsx', async ({ params, query, set, userId, request }) => {
    const lang = (query.lang ?? 'zh') as 'zh' | 'en';
    const version = (query.version ?? 'v2') as 'v1' | 'v2';
    const q = await prisma.quotation.findUnique({
      where: { id: params.id },
      include: {
        company: { include: { region: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        deal: { select: { id: true, title: true } },
        items: {
          orderBy: { position: 'asc' },
          include: {
            product: true,
            service: { include: { manDayLines: true } },
          },
        },
      },
    });
    if (!q) { set.status = 404; return { error: 'Quotation not found' }; }
    const flat = adaptCrmQuotationForExcel(q);
    const buffer = generateQuotationExcel(flat, lang, version);
    const filename = `${q.number.replace(/[\/\\:]/g, '-')}.xlsx`;
    // Audit (best-effort — 唔 blocking 個 download)
    if (userId) {
      logEvent({
        actorId: userId,
        action: 'QUOTATION_EXPORTED_XLSX',
        resourceType: 'quotation',
        resourceId: q.id,
        description: `Exported quotation ${q.number} as xlsx (${lang}/${version})`,
        metadata: { number: q.number, lang, version, fileSize: buffer.length },
        request,
      }).catch((err) => console.error('audit log failed:', err));
    }
    return new Response(buffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  }, {
    query: t.Object({
      lang: t.Optional(t.UnionEnum(['zh', 'en'])),
      version: t.Optional(t.UnionEnum(['v1', 'v2'])),
    }),
  })
  .post('/', async ({ body, userId, set, request }) => {
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const data = body as {
      companyId: string;
      dealId?: string;
      // 2026-06-26: optional follow-up salesperson. When omitted,
      // we default to the authenticated user (the most common
      // case — sales reps create their own quotes). The frontend
      // builder exposes a 銷售員 picker; this lets a sales manager
      // create a quote on behalf of someone else (e.g. an account
      // exec who doesn't have the time to log it themselves).
      salesRepId?: string;
      // P2 multi-currency (2026-06-29): billing currency picked by
      // the sales rep. One of 'RMB' | 'HKD' | 'MOP'. When omitted,
      // we fall back to the system default (RMB by default; admin
      // can change in /settings/currency).
      currency?: string;
      title?: string;
      notes?: string;
      validUntil?: string;
      taxRate?: number;
      items: Array<{
        productId?: string;
        serviceId?: string;
        sku?: string;
        name: string;
        description?: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
        manDaySnapshot?: unknown;
      }>;
    };
    // P2 multi-currency: resolve the chosen currency up front so
    // we can validate the rate lookup before we hit the DB. The
    // chosen currency persists on the row along with a snapshot
    // of the rate-to-HKD and the pre-computed totalHKD — see the
    // update step after recalcQuotationAndItems below.
    const currencyCfg = await getCurrencyConfig();
    const chosenCurrency = (data.currency || currencyCfg.default) as 'RMB' | 'HKD' | 'MOP';
    if (chosenCurrency !== 'RMB' && chosenCurrency !== 'HKD' && chosenCurrency !== 'MOP') {
      set.status = 400;
      return { error: `Unsupported currency "${chosenCurrency}". Use RMB, HKD, or MOP.` };
    }
    const rateToHKD = hkdRateFor(chosenCurrency, currencyCfg);
    if (rateToHKD == null) {
      set.status = 400;
      return { error: `No exchange rate configured for ${chosenCurrency} → HKD. Set it in /settings/currency.` };
    }
    const number = await nextQuotationNumber();
    let subtotal = 0;
    // First pass: pre-compute per-line costSnapshot + GP so we can
    // persist them on the same create.
    const items = (data.items ?? []).map((it, idx) => {
      const qty = Number(it.quantity);
      const price = Number(it.unitPrice);
      const disc = Number(it.discount ?? 0);
      const lineTotal = lineTotalOf(qty, price, disc);
      subtotal += lineTotal;
      const itemType: string = (it as { serviceId?: string }).serviceId ? 'SERVICE' : 'PRODUCT';
      return {
        itemType: itemType as never,
        productId: itemType === 'PRODUCT' ? (it as { productId?: string }).productId : undefined,
        serviceId: itemType === 'SERVICE' ? (it as { serviceId?: string }).serviceId : undefined,
        sku: (it as { sku?: string }).sku,
        name: it.name,
        description: it.description,
        quantity: qty,
        unitPrice: price,
        discount: disc,
        lineTotal,
        manDaySnapshot: ((it as { manDaySnapshot?: unknown }).manDaySnapshot ?? undefined) as never,
        position: idx,
        // costSnapshot/lineGp/lineGpPercent are filled in the second
        // pass via recalcQuotationAndItems; we can't compute them here
        // without an async call per item, so we let recalc do it.
      };
    });
    const taxRate = Number(data.taxRate ?? 0);
    // 2026-06-26: salesRepId fallback. Empty string / undefined both
    // coerce to the authenticated user; explicit null in the body
    // would be unusual (means "no salesperson") and we honour it.
    const salesRepId = data.salesRepId === null
      ? null
      : (data.salesRepId || userId);
    const created = await prisma.quotation.create({
      data: {
        number,
        companyId: data.companyId,
        dealId: data.dealId ?? null,
        createdById: userId,
        salesRepId,
        // P2 multi-currency: persist the chosen currency on the
        // create so it's available before the recalc pass.
        currency: chosenCurrency,
        title: data.title,
        notes: data.notes,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        taxRate,
        items: { create: items },
      },
      include: { items: true, company: true, salesRep: { select: { id: true, name: true, email: true } } },
    });
    // DRAFT: refresh GP from live man-day role costs.
    await recalcQuotationAndItems(created.id, { liveCostRefresh: true });
    // P2 multi-currency: snapshot the HKD equivalent now that the
    // `total` has been recomputed. We compute the HKD total from
    // the persisted `total` field, then update the row with both
    // the rate and the HKD-equivalent in a single UPDATE. The
    // snapshot is immutable from here on — future rate changes
    // will not rewrite this row's HKD figure.
    const postRecalc = await prisma.quotation.findUnique({
      where: { id: created.id },
      select: { total: true },
    });
    const totalHKD = Number(postRecalc?.total ?? 0) * rateToHKD;
    const refreshed = await prisma.quotation.update({
      where: { id: created.id },
      data: { exchangeRateToHKD: rateToHKD, totalHKD },
      include: {
        items: true,
        company: true,
        // 2026-06-26: include salesRep so the POST response (which
        // is what the builder's onSaved receives) carries the
        // sales rep for the UI to render immediately without a
        // refetch.
        salesRep: { select: { id: true, name: true, email: true } },
      },
    });
    set.status = 201;
    await logEvent({
      actorId: userId,
      action: 'QUOTATION_CREATED',
      resourceType: 'quotation',
      resourceId: created.id,
      description: `Created quotation ${created.number} for ${created.company?.name ?? data.companyId} (total ${refreshed?.total} ${chosenCurrency}, ≈ HKD ${totalHKD.toFixed(2)})`,
      metadata: {
        number: created.number,
        total: Number(refreshed?.total ?? 0),
        // P2 multi-currency (2026-06-29): include the chosen
        // currency + the snapshotted HKD fields so the audit log
        // is self-describing (a sales rep reading the log doesn't
        // need to join to the quotation row to know what the
        // customer was quoted in).
        currency: chosenCurrency,
        exchangeRateToHKD: rateToHKD,
        totalHKD,
        itemCount: items.length,
        dealId: data.dealId ?? null,
        salesRepId,
      },
      request,
    });
    return refreshed;
  }, {
    body: t.Object({
      companyId: t.String(),
      dealId: t.Optional(t.String()),
      // 2026-06-26: salesRepId is optional in the POST body. When
      // omitted, the route defaults to the authenticated userId
      // (see the route handler above).
      salesRepId: t.Optional(t.Union([t.String(), t.Null()])),
      // P2 multi-currency (2026-06-29): billing currency. When
      // omitted, the route defaults to the system default from
      // /settings/currency (RMB by default).
      currency: t.Optional(t.UnionEnum(['RMB', 'HKD', 'MOP'])),
      title: t.Optional(t.String()),
      notes: t.Optional(t.String()),
      validUntil: t.Optional(t.String()),
      taxRate: t.Optional(t.Number()),
      items: t.Array(t.Object({
        productId: t.Optional(t.String()),
        serviceId: t.Optional(t.String()),
        sku: t.Optional(t.String()),
        name: t.String(),
        description: t.Optional(t.String()),
        quantity: t.Number(),
        unitPrice: t.Number(),
        discount: t.Optional(t.Number()),
      })),
    }),
  })
    // 2026-06-26: POST /quotations/:id/revise — standard versioning
    // flow. The SENT lock (above) freezes the contractual fields
    // on any non-DRAFT quotation (title/notes/taxRate/validUntil
    // + line items). When the customer comes back with changes,
    // the sales rep needs a way to send an updated quote without
    // losing the original — this endpoint clones the source as a
    // NEW DRAFT linked via parentQuotationId, with a chain-aware
    // revisionNumber and a suffixed number (`Q-2026-0001-R1`,
    // `Q-2026-0001-R2`, etc.).
    //
    // Schema additions this relies on:
    //   - Quotation.parentQuotationId (FK to self, ON DELETE
    //     SET NULL so deleting a row in the middle of a chain
    //     doesn't orphan descendants — they just become roots).
    //   - Quotation.revisionNumber Int @default(0) — 0 for the
    //     original, 1 for R1, 2 for R2, etc. Position counter
    //     so the UI can render "R2 of 4" without walking the
    //     chain every time.
    //
    // Allowed source statuses: anything except DRAFT (because a
    // DRAFT can just be edited directly via the builder). The
    // SENT/VIEWED/ACCEPTED/REJECTED/EXPIRED/INVOICED set all map
    // to legitimate "we need a new draft because the locked one
    // can't change" scenarios.
    .post('/:id/revise', async ({ params, userId, set, request }) => {
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const source = await prisma.quotation.findUnique({
      where: { id: params.id },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!source) { set.status = 404; return { error: 'Source quotation not found' }; }
    if (source.status === 'DRAFT') {
      // A DRAFT can be edited directly; revising it would just
      // create a duplicate that confuses the audit trail. Tell
      // the user to edit the existing draft instead.
      set.status = 409;
      return {
        error: 'Source quotation is DRAFT — edit it directly instead of creating a revision.',
      };
    }

    // Compute the chain-aware number + revisionNumber.
    // nextRevisionInfo walks the parent chain to the root, then
    // BFS-counts every descendant to pick the next position. See
    // the function's JSDoc above for the algorithm.
    const { number, revisionNumber } = await nextRevisionInfo(source.id);

    const created = await prisma.quotation.create({
      data: {
        number,
        companyId: source.companyId,
        dealId: source.dealId,
        createdById: userId,
        // Inherit the source's sales rep when set, otherwise
        // default to the current user (the most common case —
        // the same person clicking "revise" should remain the
        // follow-up rep).
        salesRepId: source.salesRepId ?? userId,
        title: source.title,
        notes: source.notes,
        validUntil: source.validUntil,
        taxRate: source.taxRate,
        // P2 multi-currency (2026-06-29): inherit the source's
        // billing currency + HKD snapshot. The new draft opens
        // with the same contractual numbers the customer saw on
        // the previous version — sales reps edit the draft and
        // can change the currency later if needed.
        currency: source.currency,
        exchangeRateToHKD: source.exchangeRateToHKD,
        totalHKD: source.totalHKD,
        status: 'DRAFT',
        // 2026-06-26: standard-versioning links. Persisted on
        // the row so the detail page can render the chain
        // ("修訂自 Q-2026-0001") and the audit log isn't the
        // only place the relationship lives.
        parentQuotationId: source.id,
        revisionNumber,
        // Cloned items preserve the snapshot fields so a deleted
        // /renamed Product/Service still shows in the new draft
        // (matches the P1-10 / P2-snapshot-display contract).
        items: {
          create: source.items.map((it) => ({
            itemType: it.itemType,
            productId: it.productId,
            serviceId: it.serviceId,
            sku: it.sku,
            name: it.name,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discount: it.discount,
            manDaySnapshot: it.manDaySnapshot ?? undefined,
            position: it.position,
            // costSnapshot / lineGp / lineGpPercent will be
            // recomputed in the second pass via
            // recalcQuotationAndItems below.
          })),
        },
      },
      include: {
        items: true,
        company: true,
        salesRep: { select: { id: true, name: true, email: true } },
        // Include parent so the response carries the link the
        // detail page needs to render the "修訂自 X" chip.
        parentQuotation: { select: { id: true, number: true } },
      },
    });

    // Same post-create recalc as POST /quotations so the new
    // DRAFT has correct subtotal/taxAmount/total/GP% from the
    // start (no manual "save then refresh" round-trip for the
    // user).
    await recalcQuotationAndItems(created.id, { liveCostRefresh: true });
    const refreshed = await prisma.quotation.findUnique({
      where: { id: created.id },
      include: {
        items: true,
        company: true,
        salesRep: { select: { id: true, name: true, email: true } },
        parentQuotation: { select: { id: true, number: true } },
      },
    });

    set.status = 201;
    await logEvent({
      actorId: userId,
      action: 'QUOTATION_CREATED',
      resourceType: 'quotation',
      resourceId: created.id,
      // Description explicitly names the source so an admin
      // scanning the audit log can see "this is a revision of
      // Q-2026-0001" without needing to join to the metadata
      // table.
      description: `Created revision of quotation ${source.number} (source id: ${source.id}); new number ${created.number}`,
      metadata: {
        number: created.number,
        total: Number(refreshed?.total ?? 0),
        itemCount: source.items.length,
        dealId: source.dealId,
        salesRepId: created.salesRepId,
        // Revision chain metadata. The parentQuotationId FK is
        // the source of truth; we keep these in the audit log
        // too for queries that scan logs by source.
        parentQuotationId: source.id,
        parentQuotationNumber: source.number,
        revisionNumber: created.revisionNumber,
      },
      request,
    });
    return refreshed;
  })
  // Update header (title, notes, validUntil, taxRate, status, dealId, salesRepId, currency)
  .patch('/:id', async ({ params, body, set, userId, request }) => {
    const data = body as {
      title?: string;
      notes?: string;
      validUntil?: string | null;
      taxRate?: number;
      status?: string;
      // 2026-06-26: PATCH now accepts dealId. Setting it links the
      // quotation to a Deal (sales pipeline opportunity); passing
      // null / empty string clears the link. The frontend's
      // QuotationBuilder's edit-mode PATCH call includes this field
      // so a quotation can be moved between Deals (or off a Deal
      // entirely) while still in DRAFT.
      dealId?: string | null;
      // 2026-06-26: PATCH also accepts salesRepId to reassign the
      // follow-up salesperson. Unlike title/notes/taxRate this is
      // NOT covered by the SENT lock — the sales rep is internal
      // metadata, and you need to be able to reassign it (e.g.
      // when a colleague leaves the company) regardless of where
      // the quotation is in its lifecycle.
      salesRepId?: string | null;
      // P2 multi-currency (2026-06-29): billing currency picked by
      // the sales rep. This IS covered by the SENT lock (below)
      // because the printed quote shows the currency — changing it
      // after SENT would be a contract rewrite.
      currency?: string;
    };
    const before = await prisma.quotation.findUnique({ where: { id: params.id } });
    if (!before) { set.status = 404; return { error: 'Not found' }; }

    // SENT lock: reject edits to non-status fields once the quotation has
    // been sent. The status field itself is still mutable (so the user
    // can mark it ACCEPTED, REJECTED, etc.) but the title/notes/etc.
    // are frozen because they form part of the contractual record.
    //
    // What's in the lock (contractual — appears on the customer-
    // facing document):
    //   title, notes, taxRate, validUntil, currency
    //   plus the line items (handled separately by the items POST/
    //   PATCH/DELETE routes, all of which already 409 outside DRAFT)
    //
    // What's NOT in the lock (CRM metadata — internal classification):
    //   dealId    — can be linked to a deal retroactively (e.g. the
    //               rep creates the deal after sending the quote).
    //               The audit log still records the change.
    //   salesRepId — owner reassignment is always permitted (e.g. when
    //                a colleague leaves the company).
    //   status    — already excluded by the `if` not including it.
    //
    // 2026-06-26: an earlier draft of this comment incorrectly argued
    // that dealId should be locked because changing it would "change
    // the sales-attribution trail". That was wrong: sales attribution
    // is salesRepId / createdById, not dealId. Locking dealId broke
    // the legitimate use case of attaching a sent quotation to a deal
    // after the fact (user-reported 2026-06-26).
    //
    // 2026-06-29: `currency` joins the lock list (P2 multi-currency).
    // Changing the billing currency after SENT would silently
    // re-interpret the customer's contract; the only correct path is
    // to create a revision.
    if (before.status !== 'DRAFT' && before.status !== undefined) {
      if (
        data.title !== undefined ||
        data.notes !== undefined ||
        data.validUntil !== undefined ||
        data.taxRate !== undefined ||
        data.currency !== undefined
      ) {
        set.status = 409;
        return { error: `Quotation is ${before.status} and cannot be edited. Create a revision instead.` };
      }
    }

    const update: Record<string, unknown> = {};
    if (data.title !== undefined) update.title = data.title;
    if (data.notes !== undefined) update.notes = data.notes;
    if (data.validUntil !== undefined) {
      update.validUntil = data.validUntil ? new Date(data.validUntil) : null;
    }
    if (data.taxRate !== undefined) update.taxRate = Number(data.taxRate);
    // 2026-06-26: accept dealId in PATCH body. The frontend sends
    // `dealId: <id>` to link, `dealId: null` (or "") to unlink, and
    // omits the field to leave it unchanged. Coerce empty string to
    // null so a cleared autocomplete cleanly removes the FK.
    if (data.dealId !== undefined) update.dealId = data.dealId || null;
    // 2026-06-26: accept salesRepId in PATCH body. Same semantics as
    // dealId — explicit string sets, null / "" clears, undefined
    // leaves unchanged. NOT covered by the SENT lock (see the
    // contract comment on the typecast above).
    if (data.salesRepId !== undefined) update.salesRepId = data.salesRepId || null;
    // P2 multi-currency (2026-06-29): accept currency. We do the
    // rate lookup BEFORE the update so we can fail with a 400 if
    // the admin hasn't configured a rate for the chosen currency
    // (the field already passed the SENT-lock check above, so we
    // know we're in DRAFT). The chosen currency also flows into
    // the recalc below so the new HKD total is consistent.
    let rateToHKD: number | null = null;
    let chosenCurrency: string | undefined;
    if (data.currency !== undefined) {
      if (data.currency !== 'RMB' && data.currency !== 'HKD' && data.currency !== 'MOP') {
        set.status = 400;
        return { error: `Unsupported currency "${data.currency}". Use RMB, HKD, or MOP.` };
      }
      const cfg = await getCurrencyConfig();
      rateToHKD = hkdRateFor(data.currency, cfg);
      if (rateToHKD == null) {
        set.status = 400;
        return { error: `No exchange rate configured for ${data.currency} → HKD. Set it in /settings/currency.` };
      }
      update.currency = data.currency;
      chosenCurrency = data.currency;
    }
    if (data.status !== undefined) {
      const valid = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED'];
      if (!valid.includes(data.status)) { set.status = 400; return { error: 'Invalid status' }; }
      update.status = data.status;
      if (data.status === 'SENT') update.sentAt = new Date();
      if (data.status === 'ACCEPTED') update.acceptedAt = new Date();
    }
    const q = await prisma.quotation.update({ where: { id: params.id }, data: update as never });
    // Recalc totals if tax rate changed; for DRAFT also refresh GP.
    if (data.taxRate !== undefined || (data.status === undefined && before.status === 'DRAFT')) {
      await recalcQuotationAndItems(params.id, { liveCostRefresh: before.status === 'DRAFT' });
    }
    // P2 multi-currency: re-snapshot totalHKD whenever the
    // currency was changed (we just stored the new currency) OR
    // whenever the total itself could have moved (tax rate change,
    // DRAFT line-item re-snapshot). The defensive recompute on
    // every PATCH in DRAFT state means the HKD figure stays
    // consistent with the persisted `total` without the frontend
    // having to ask for it.
    const effectiveCurrency = chosenCurrency ?? before.currency;
    if (rateToHKD == null) {
      // Currency wasn't changed in this PATCH — but the total may
      // have moved (e.g. tax rate change). Re-derive the rate from
      // the existing currency and recompute totalHKD so the
      // snapshot stays in sync.
      const cfg = await getCurrencyConfig();
      rateToHKD = hkdRateFor(effectiveCurrency, cfg);
    }
    if (rateToHKD != null) {
      const postRecalc = await prisma.quotation.findUnique({
        where: { id: params.id },
        select: { total: true },
      });
      await prisma.quotation.update({
        where: { id: params.id },
        data: {
          exchangeRateToHKD: rateToHKD,
          totalHKD: Number(postRecalc?.total ?? 0) * rateToHKD,
        },
      });
    }
    const refreshed = await prisma.quotation.findUnique({
      where: { id: params.id },
      include: {
        items: { include: { product: true, service: { include: { manDayLines: true } } } },
        company: true,
        // 2026-06-26: PATCH response carries salesRep so the
        // builder's onSaved receives the new rep without a refetch.
        salesRep: { select: { id: true, name: true, email: true } },
      },
    });
    if (data.status && data.status !== before.status) {
      await logEvent({
        actorId: userId ?? null,
        action: 'QUOTATION_STATUS_CHANGED',
        resourceType: 'quotation',
        resourceId: params.id,
        description: `${q.number} status: ${before.status} -> ${data.status}`,
        metadata: { from: before.status, to: data.status, number: q.number },
        request,
      });
    } else if (Object.keys(data).length > 0) {
      await logEvent({
        actorId: userId ?? null,
        action: 'QUOTATION_UPDATED',
        resourceType: 'quotation',
        resourceId: params.id,
        description: `Updated quotation ${q.number} (${q.company?.name ?? ''})`,
        metadata: {
          number: q.number,
          fields: Object.keys(data),
          // P2 multi-currency (2026-06-29): include the HKD
          // fields in the audit metadata so a sales rep scanning
          // the log can see what was actually persisted (e.g.
          // "currency changed RMB→HKD, totalHKD reset to total").
          currency: refreshed?.currency,
          exchangeRateToHKD: refreshed ? Number(refreshed.exchangeRateToHKD) : undefined,
          totalHKD: refreshed ? Number(refreshed.totalHKD) : undefined,
        },
        request,
      });
    }
    return refreshed;
  })
  .delete('/:id', async ({ params, userId, request }) => {
    const before = await prisma.quotation.findUnique({ where: { id: params.id }, include: { company: { select: { name: true } } } });
    await prisma.quotation.delete({ where: { id: params.id } });
    if (before) {
      await logEvent({
        actorId: userId ?? null,
        action: 'QUOTATION_DELETED',
        resourceType: 'quotation',
        resourceId: params.id,
        description: `Deleted quotation ${before.number} (${before.company?.name ?? ''})`,
        metadata: { number: before.number, total: Number(before.total) },
        request,
      });
    }
    return { success: true };
  })
  // Status transition shortcut. The key Day N behaviour here: when
  // status moves to SENT, the quotation is *locked* from here on. We
  // also reject SENT if any SERVICE line has costSnapshot == 0 (which
  // would mean the admin never set a cost on the man-day role, giving
  // the line a fake 100% GP).
  .post('/:id/status', async ({ params, body, set, userId, request }) => {
    const { status } = body as { status: string };
    const valid = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED'];
    if (!valid.includes(status)) { set.status = 400; return { error: 'Invalid status' }; }
    const before = await prisma.quotation.findUnique({ where: { id: params.id }, select: { status: true, number: true } });
    if (!before) { set.status = 404; return { error: 'Not found' }; }

    if (status === 'SENT') {
      // Last chance to refresh GP from live ManDayRole costs before
      // we freeze them.
      await recalcQuotationAndItems(params.id, { liveCostRefresh: true });
      // Verify every service line has a non-zero costSnapshot
      const svcLines = await prisma.quotationItem.findMany({
        where: { quotationId: params.id, itemType: 'SERVICE' },
        select: { id: true, name: true, costSnapshot: true, lineTotal: true },
      });
      const zeroCost = svcLines.filter((l) => Number(l.costSnapshot) === 0 && Number(l.lineTotal) > 0);
      if (zeroCost.length > 0) {
        set.status = 422;
        return {
          error: 'Cannot send: the following service lines have zero cost configured. Set a man-day role cost first.',
          lines: zeroCost.map((l) => ({ id: l.id, name: l.name })),
        };
      }
    }

    const data: Record<string, unknown> = { status };
    if (status === 'SENT') data.sentAt = new Date();
    if (status === 'ACCEPTED') data.acceptedAt = new Date();
    const updated = await prisma.quotation.update({ where: { id: params.id }, data: data as never });
    // P2 multi-currency (2026-06-29): defensive recompute of
    // totalHKD on the SENT transition. The recalc above
    // (recalcQuotationAndItems) may have changed `total` (e.g.
    // service-line cost snapshot update), and we want the HKD
    // figure that prints on the customer's quote to reflect the
    // final total, not a stale value from before the SENT lock.
    if (status === 'SENT') {
      const cfg = await getCurrencyConfig();
      const rate = hkdRateFor(updated.currency, cfg);
      if (rate != null) {
        await prisma.quotation.update({
          where: { id: params.id },
          data: {
            exchangeRateToHKD: rate,
            totalHKD: Number(updated.total) * rate,
          },
        });
      }
    }
    await logEvent({
      actorId: userId ?? null,
      action: 'QUOTATION_STATUS_CHANGED',
      resourceType: 'quotation',
      resourceId: params.id,
      description: `${before.number} status: ${before.status} -> ${status}`,
      metadata: { from: before.status, to: status, number: before.number },
      request,
    });
    return updated;
  })
  // Add a line item
  .post('/:id/items', async ({ params, body, set }) => {
    const data = body as {
      productId?: string;
      serviceId?: string;
      sku?: string;
      name: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      discount?: number;
      manDaySnapshot?: unknown;
    };
    const quotation = await prisma.quotation.findUnique({ where: { id: params.id }, select: { status: true } });
    if (!quotation) { set.status = 404; return { error: 'Quotation not found' }; }
    if (quotation.status !== 'DRAFT') {
      set.status = 409;
      return { error: `Quotation is ${quotation.status} and cannot be modified. Create a revision instead.` };
    }
    const last = await prisma.quotationItem.findFirst({
      where: { quotationId: params.id },
      orderBy: { position: 'desc' },
    });
    const position = (last?.position ?? -1) + 1;
    const lineTotal = lineTotalOf(Number(data.quantity), Number(data.unitPrice), Number(data.discount ?? 0));
    const itemType: string = data.serviceId ? 'SERVICE' : 'PRODUCT';
    const costPerManDay = await resolveServiceCostSnapshot(data.serviceId, data.manDaySnapshot, true);
    const costSnapshot = costPerManDay * Number(data.quantity);
    const { lineGp, lineGpPercent } = gpOf(itemType, lineTotal, costSnapshot);
    const item = await prisma.quotationItem.create({
      data: {
        quotationId: params.id,
        itemType: itemType as never,
        productId: itemType === 'PRODUCT' ? data.productId : null,
        serviceId: itemType === 'SERVICE' ? data.serviceId : null,
        sku: data.sku,
        name: data.name,
        description: data.description,
        quantity: Number(data.quantity),
        unitPrice: Number(data.unitPrice),
        discount: Number(data.discount ?? 0),
        lineTotal,
        costSnapshot,
        lineGp,
        lineGpPercent,
        manDaySnapshot: (data.manDaySnapshot ?? undefined) as never,
        position,
      },
    });
    await recalcQuotationAndItems(params.id, { liveCostRefresh: true });
    return item;
  })
  // Update a line item
  .patch('/:id/items/:itemId', async ({ params, body, set }) => {
    const data = body as { name?: string; description?: string; quantity?: number; unitPrice?: number; discount?: number };
    const existing = await prisma.quotationItem.findUnique({ where: { id: params.itemId } });
    if (!existing || existing.quotationId !== params.id) { set.status = 404; return { error: 'Item not found' }; }
    const quotation = await prisma.quotation.findUnique({ where: { id: params.id }, select: { status: true } });
    if (!quotation) { set.status = 404; return { error: 'Quotation not found' }; }
    if (quotation.status !== 'DRAFT') {
      set.status = 409;
      return { error: `Quotation is ${quotation.status} and cannot be modified. Create a revision instead.` };
    }
    const qty = data.quantity !== undefined ? Number(data.quantity) : Number(existing.quantity);
    const price = data.unitPrice !== undefined ? Number(data.unitPrice) : Number(existing.unitPrice);
    const disc = data.discount !== undefined ? Number(data.discount) : Number(existing.discount);
    const newLineTotal = lineTotalOf(qty, price, disc);
    // Re-snapshot cost from live man-day role prices (DRAFT behaviour)
    const costPerManDay = await resolveServiceCostSnapshot(existing.serviceId, existing.manDaySnapshot, true);
    const costSnapshot = costPerManDay * qty;
    const { lineGp, lineGpPercent } = gpOf(existing.itemType, newLineTotal, costSnapshot);
    const item = await prisma.quotationItem.update({
      where: { id: params.itemId },
      data: {
        name: data.name,
        description: data.description,
        quantity: qty,
        unitPrice: price,
        discount: disc,
        lineTotal: newLineTotal,
        costSnapshot,
        lineGp,
        lineGpPercent,
      },
    });
    await recalcQuotationAndItems(params.id, { liveCostRefresh: true });
    return item;
  })
  // Delete a line item
  .delete('/:id/items/:itemId', async ({ params, set }) => {
    const existing = await prisma.quotationItem.findUnique({ where: { id: params.itemId } });
    if (!existing || existing.quotationId !== params.id) { set.status = 404; return { error: 'Item not found' }; }
    const quotation = await prisma.quotation.findUnique({ where: { id: params.id }, select: { status: true } });
    if (!quotation) { set.status = 404; return { error: 'Quotation not found' }; }
    if (quotation.status !== 'DRAFT') {
      set.status = 409;
      return { error: `Quotation is ${quotation.status} and cannot be modified. Create a revision instead.` };
    }
    await prisma.quotationItem.delete({ where: { id: params.itemId } });
    await recalcQuotationAndItems(params.id, { liveCostRefresh: true });
    return { success: true };
  });
