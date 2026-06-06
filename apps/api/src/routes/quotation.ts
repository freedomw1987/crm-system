// @ts-nocheck — see rbac.ts for the Elysia 1.2 + TS 5.x d.ts trade-off
import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';

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

/**
 * Day N: GP calculation for a single line item.
 *   - PRODUCT: costSnapshot = 0  → lineGp = lineTotal, lineGpPercent = 100
 *   - SERVICE: costSnapshot = sum(manDayLine.costRate * days) at line
 *     creation time. lineGp = lineTotal - (costSnapshot * quantity for
 *     the "man-day units"). The "man-day units" here is the *quantity*
 *     because a service quotation line's quantity is already the
 *     man-day count. lineGpPercent = lineGp / lineTotal.
 *
 *   Example: Senior Engineer (¥1000 sell, ¥600 cost) × 5 days
 *     lineTotal = 1000 * 5 = 5000
 *     costSnapshot = 600 * 5 = 3000  (per line cost)
 *     lineGp = 5000 - 3000 = 2000
 *     lineGpPercent = 2000 / 5000 = 40%
 */
function gpOf(
  itemType: string,
  lineTotal: number,
  costSnapshot: number,
): { lineGp: number; lineGpPercent: number } {
  if (itemType === 'PRODUCT') {
    return { lineGp: lineTotal, lineGpPercent: 100 };
  }
  const gp = lineTotal - costSnapshot;
  const percent = lineTotal > 0 ? (gp / lineTotal) * 100 : 0;
  return { lineGp: gp, lineGpPercent: percent };
}

/**
 * Extract the per-line cost (per *man-day unit*) from a manDaySnapshot.
 * The snapshot is the JSON object stored on QuotationItem.manDaySnapshot
 * that captures the SOW breakdown at quotation-creation time:
 *   { lines: [{ role, dayRate, days, costRate, subtotal }], notes }
 *
 * Returns cost per man-day unit (i.e. weighted-average cost across the
 * snapshot's lines). The line's "quantity" field in the quotation is
 * then the number of man-days, so multiplying costPerManDay by quantity
 * gives the line's costSnapshot.
 */
function costPerManDayFromSnapshot(snap: unknown): number {
  if (!snap || typeof snap !== 'object') return 0;
  const lines = (snap as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length === 0) return 0;
  let totalCost = 0;
  let totalDays = 0;
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    const days = Number((l as { days?: number }).days ?? 0);
    const costRate = Number((l as { costRate?: number }).costRate ?? 0);
    totalCost += costRate * days;
    totalDays += days;
  }
  if (totalDays <= 0) return 0;
  return totalCost / totalDays;
}

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
    const { companyId, status, createdById, dealId, limit = '50', offset = '0' } = query as {
      companyId?: string;
      status?: string;
      createdById?: string;
      dealId?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (createdById) where.createdById = createdById;
    if (dealId) where.dealId = dealId;
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
    };
    const before = await prisma.quotation.findUnique({ where: { id: params.id } });
    if (!before) { set.status = 404; return { error: 'Not found' }; }

    // SENT lock: reject edits to non-status fields once the quotation has
    // been sent. The status field itself is still mutable (so the user
    // can mark it ACCEPTED, REJECTED, etc.) but the title/notes/etc.
    // are frozen because they form part of the contractual record.
    if (before.status !== 'DRAFT' && before.status !== undefined) {
      if (data.title !== undefined || data.notes !== undefined || data.validUntil !== undefined || data.taxRate !== undefined) {
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
