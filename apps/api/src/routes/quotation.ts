// @ts-nocheck — see rbac.ts for the Elysia 1.2 + TS 5.x d.ts trade-off
import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { toIdArray } from '../lib/query-helpers';
// 2026-06-07 (US-A5): port 落 CRM 嘅 Excel 5-sheet generator + Prisma adapter
import { adaptCrmQuotationForExcel } from '../lib/excel/crm-adapter';
import { generateQuotationExcel } from '../lib/excel/quotation';

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
    const created = await prisma.quotation.create({
      data: {
        number,
        companyId: data.companyId,
        dealId: data.dealId ?? null,
        createdById: userId,
        title: data.title,
        notes: data.notes,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        taxRate,
        items: { create: items },
      },
      include: { items: true, company: true },
    });
    // DRAFT: refresh GP from live man-day role costs.
    await recalcQuotationAndItems(created.id, { liveCostRefresh: true });
    const refreshed = await prisma.quotation.findUnique({
      where: { id: created.id },
      include: { items: true, company: true },
    });
    set.status = 201;
    await logEvent({
      actorId: userId,
      action: 'QUOTATION_CREATED',
      resourceType: 'quotation',
      resourceId: created.id,
      description: `Created quotation ${created.number} for ${created.company?.name ?? data.companyId} (total ${refreshed?.total})`,
      metadata: { number: created.number, total: Number(refreshed?.total ?? 0), itemCount: items.length, dealId: data.dealId ?? null },
      request,
    });
    return refreshed;
  }, {
    body: t.Object({
      companyId: t.String(),
      dealId: t.Optional(t.String()),
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
  // Update header (title, notes, validUntil, taxRate, status)
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
    };
    const before = await prisma.quotation.findUnique({ where: { id: params.id } });
    if (!before) { set.status = 404; return { error: 'Not found' }; }

    // SENT lock: reject edits to non-status fields once the quotation has
    // been sent. The status field itself is still mutable (so the user
    // can mark it ACCEPTED, REJECTED, etc.) but the title/notes/etc.
    // are frozen because they form part of the contractual record.
    // 2026-06-26: also include dealId in the SENT lock — moving a
    // sent quotation to a different deal would silently change the
    // sales-attribution trail.
    if (before.status !== 'DRAFT' && before.status !== undefined) {
      if (
        data.title !== undefined ||
        data.notes !== undefined ||
        data.validUntil !== undefined ||
        data.taxRate !== undefined ||
        data.dealId !== undefined
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
    const refreshed = await prisma.quotation.findUnique({
      where: { id: params.id },
      include: { items: { include: { product: true, service: { include: { manDayLines: true } } } }, company: true },
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
        metadata: { number: q.number, fields: Object.keys(data) },
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
