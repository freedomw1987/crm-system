import { Elysia } from 'elysia';
import { prisma } from '@crm/db';

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

export const quotationRoutes = new Elysia({ prefix: '/quotations', tags: ['quotations'] })
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
  .post('/', async ({ body, set }) => {
    const data = body as { companyId: string; createdById: string; items: Array<{ productId?: string; sku?: string; name: string; quantity: number; unitPrice: number; discount?: number; description?: string }>; title?: string; notes?: string; validUntil?: string; taxRate?: number; generatedByAi?: boolean; aiPrompt?: string };
    const number = await nextQuotationNumber();
    let subtotal = 0;
    const items = data.items.map((it, idx) => {
      const qty = Number(it.quantity);
      const price = Number(it.unitPrice);
      const disc = Number(it.discount ?? 0);
      const lineTotal = qty * price * (1 - disc / 100);
      subtotal += lineTotal;
      return {
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        description: it.description,
        quantity: qty,
        unitPrice: price,
        discount: disc,
        lineTotal,
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
        createdById: data.createdById,
        title: data.title,
        notes: data.notes,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        subtotal,
        taxRate,
        taxAmount,
        total,
        generatedByAi: data.generatedByAi ?? false,
        aiPrompt: data.aiPrompt,
        items: { create: items },
      },
      include: { items: true, company: true },
    });
    set.status = 201;
    return created;
  })
  .patch('/:id', async ({ params, body }) => {
    return prisma.quotation.update({ where: { id: params.id }, data: body as never });
  })
  .delete('/:id', async ({ params }) => {
    await prisma.quotation.delete({ where: { id: params.id } });
    return { success: true };
  })
  // Update status (send / accept / reject)
  .post('/:id/status', async ({ params, body, set }) => {
    const { status } = body as { status: string };
    const validStatuses = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED'];
    if (!validStatuses.includes(status)) {
      set.status = 400;
      return { error: 'Invalid status' };
    }
    const data: Record<string, unknown> = { status };
    if (status === 'SENT') data.sentAt = new Date();
    if (status === 'ACCEPTED') data.acceptedAt = new Date();
    return prisma.quotation.update({
      where: { id: params.id },
      data: data as never,
    });
  });
