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

// Recalculate quotation totals from its line items
async function recalcQuotation(quotationId: string) {
  const items = await prisma.quotationItem.findMany({ where: { quotationId } });
  const q = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!q) return null;
  const subtotal = items.reduce((s, it) => s + Number(it.lineTotal), 0);
  const taxAmount = subtotal * (Number(q.taxRate) / 100);
  const total = subtotal + taxAmount;
  return prisma.quotation.update({
    where: { id: quotationId },
    data: { subtotal, taxAmount, total },
  });
}

// Compute line total for an item
function lineTotalOf(qty: number, price: number, disc: number) {
  return qty * price * (1 - disc / 100);
}

export const quotationRoutes = new Elysia({ prefix: '/quotations', tags: ['quotations'] })
  .use(authContext)
  .get('/', async ({ query }) => {
    const { companyId, status, createdById, limit = '50', offset = '0' } = query as {
      companyId?: string;
      status?: string;
      createdById?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (createdById) where.createdById = createdById;
    return prisma.quotation.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
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
        items: { include: { product: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!q) { set.status = 404; return { error: 'Not found' }; }
    return q;
  })
  .post('/', async ({ body, userId, set, request }) => {
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const data = body as {
      companyId: string;
      title?: string;
      notes?: string;
      validUntil?: string;
      taxRate?: number;
      items: Array<{
        productId?: string;
        sku?: string;
        name: string;
        description?: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
      }>;
    };
    const number = await nextQuotationNumber();
    let subtotal = 0;
    const items = (data.items ?? []).map((it, idx) => {
      const qty = Number(it.quantity);
      const price = Number(it.unitPrice);
      const disc = Number(it.discount ?? 0);
      const lineTotal = lineTotalOf(qty, price, disc);
      subtotal += lineTotal;
      // Polymorphic item type — service items carry an optional man-day
      // snapshot so the quotation stays self-contained even if the service
      // is later archived or its pricing changes.
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
      };
    });
    const taxRate = Number(data.taxRate ?? 0);
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;
    const created = await prisma.quotation.create({
      data: {
        number,
        companyId: data.companyId,
        createdById: userId,
        title: data.title,
        notes: data.notes,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        subtotal,
        taxRate,
        taxAmount,
        total,
        items: { create: items },
      },
      include: { items: true, company: true },
    });
    set.status = 201;
    await logEvent({
      actorId: userId,
      action: 'QUOTATION_CREATED',
      resourceType: 'quotation',
      resourceId: created.id,
      description: `Created quotation ${created.number} for ${created.company?.name ?? data.companyId} (total ${created.total})`,
      metadata: { number: created.number, total: Number(created.total), itemCount: items.length },
      request,
    });
    return created;
  }, {
    body: t.Object({
      companyId: t.String(),
      title: t.Optional(t.String()),
      notes: t.Optional(t.String()),
      validUntil: t.Optional(t.String()),
      taxRate: t.Optional(t.Number()),
      items: t.Array(t.Object({
        productId: t.Optional(t.String()),
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
    // Recalc totals if tax rate changed
    if (data.taxRate !== undefined) await recalcQuotation(params.id);
    const refreshed = await prisma.quotation.findUnique({
      where: { id: params.id },
      include: { items: { include: { product: true } }, company: true },
    });
    if (data.status && data.status !== q.status) {
      await logEvent({
        actorId: userId ?? null,
        action: 'QUOTATION_STATUS_CHANGED',
        resourceType: 'quotation',
        resourceId: params.id,
        description: `${q.number} status: ${q.status} -> ${data.status}`,
        metadata: { from: q.status, to: data.status, number: q.number },
        request,
      });
    } else {
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
  // Status transition shortcut
  .post('/:id/status', async ({ params, body, set, userId, request }) => {
    const { status } = body as { status: string };
    const valid = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED'];
    if (!valid.includes(status)) { set.status = 400; return { error: 'Invalid status' }; }
    const data: Record<string, unknown> = { status };
    if (status === 'SENT') data.sentAt = new Date();
    if (status === 'ACCEPTED') data.acceptedAt = new Date();
    const before = await prisma.quotation.findUnique({ where: { id: params.id }, select: { status: true, number: true } });
    const updated = await prisma.quotation.update({ where: { id: params.id }, data: data as never });
    await logEvent({
      actorId: userId ?? null,
      action: 'QUOTATION_STATUS_CHANGED',
      resourceType: 'quotation',
      resourceId: params.id,
      description: `${before?.number ?? params.id} status: ${before?.status ?? '?'} -> ${status}`,
      metadata: { from: before?.status, to: status, number: before?.number },
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
    const last = await prisma.quotationItem.findFirst({
      where: { quotationId: params.id },
      orderBy: { position: 'desc' },
    });
    const position = (last?.position ?? -1) + 1;
    const lineTotal = lineTotalOf(Number(data.quantity), Number(data.unitPrice), Number(data.discount ?? 0));
    const itemType: string = data.serviceId ? 'SERVICE' : 'PRODUCT';
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
        manDaySnapshot: (data.manDaySnapshot ?? undefined) as never,
        position,
      },
    });
    await recalcQuotation(params.id);
    return item;
  })
  // Update a line item
  .patch('/:id/items/:itemId', async ({ params, body, set }) => {
    const data = body as { name?: string; description?: string; quantity?: number; unitPrice?: number; discount?: number };
    const existing = await prisma.quotationItem.findUnique({ where: { id: params.itemId } });
    if (!existing || existing.quotationId !== params.id) { set.status = 404; return { error: 'Item not found' }; }
    const qty = data.quantity !== undefined ? Number(data.quantity) : Number(existing.quantity);
    const price = data.unitPrice !== undefined ? Number(data.unitPrice) : Number(existing.unitPrice);
    const disc = data.discount !== undefined ? Number(data.discount) : Number(existing.discount);
    const item = await prisma.quotationItem.update({
      where: { id: params.itemId },
      data: {
        name: data.name,
        description: data.description,
        quantity: qty,
        unitPrice: price,
        discount: disc,
        lineTotal: lineTotalOf(qty, price, disc),
      },
    });
    await recalcQuotation(params.id);
    return item;
  })
  // Delete a line item
  .delete('/:id/items/:itemId', async ({ params }) => {
    const existing = await prisma.quotationItem.findUnique({ where: { id: params.itemId } });
    if (!existing || existing.quotationId !== params.id) return { error: 'Item not found' };
    await prisma.quotationItem.delete({ where: { id: params.itemId } });
    await recalcQuotation(params.id);
    return { success: true };
  });
