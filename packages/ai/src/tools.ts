/**
 * AI Agent tool registry
 *
 * Each tool defines: name, description, OpenAI function-calling JSON schema, and execute().
 * The agent will be able to call these to interact with the CRM.
 */

import { prisma } from '@crm/db';

export interface ToolContext {
  userId: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: any, ctx: ToolContext) => Promise<unknown>;
}

// ============================================================
// Tool: search_companies
// ============================================================
const searchCompanies: Tool = {
  name: 'search_companies',
  description: 'Search for customer companies by name, industry, or status. Returns matching companies with contact counts and deal counts.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term (matches name, legal name, email)' },
      industry: { type: 'string', description: 'Filter by industry' },
      status: { type: 'string', enum: ['active', 'inactive', 'blacklisted'], description: 'Filter by status' },
      limit: { type: 'number', description: 'Max results (default 10)' },
    },
  },
  execute: async (args) => {
    const where: Record<string, unknown> = {};
    if (args.status) where.status = args.status;
    if (args.industry) where.industry = args.industry;
    if (args.query) {
      where.OR = [
        { name: { contains: args.query, mode: 'insensitive' } },
        { legalName: { contains: args.query, mode: 'insensitive' } },
        { email: { contains: args.query, mode: 'insensitive' } },
      ];
    }
    const companies = await prisma.company.findMany({
      where,
      take: args.limit ?? 10,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { contacts: true, quotations: true, deals: true } },
      },
    });
    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      status: c.status,
      contactCount: c._count.contacts,
      quotationCount: c._count.quotations,
      dealCount: c._count.deals,
    }));
  },
};

// ============================================================
// Tool: get_company
// ============================================================
const getCompany: Tool = {
  name: 'get_company',
  description: 'Get detailed information about a specific company by ID, including contacts, addresses, recent quotations, and deals.',
  parameters: {
    type: 'object',
    properties: {
      companyId: { type: 'string', description: 'The company ID' },
    },
    required: ['companyId'],
  },
  execute: async (args) => {
    const c = await prisma.company.findUnique({
      where: { id: args.companyId },
      include: {
        contacts: true,
        addresses: true,
        quotations: { take: 10, orderBy: { createdAt: 'desc' } },
        deals: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });
    return c;
  },
};

// ============================================================
// Tool: search_products
// ============================================================
const searchProducts: Tool = {
  name: 'search_products',
  description: 'Search the product catalog by name, SKU, category, or description.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term' },
      category: { type: 'string', description: 'Filter by category' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
  },
  execute: async (args) => {
    const where: Record<string, unknown> = { status: 'ACTIVE' };
    if (args.category) where.category = args.category;
    if (args.query) {
      where.OR = [
        { name: { contains: args.query, mode: 'insensitive' } },
        { sku: { contains: args.query, mode: 'insensitive' } },
        { description: { contains: args.query, mode: 'insensitive' } },
      ];
    }
    return prisma.product.findMany({
      where,
      take: args.limit ?? 20,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        category: true,
        unitPrice: true,
        currency: true,
        stockQuantity: true,
      },
    });
  },
};

// ============================================================
// Tool: list_quotations
// ============================================================
const listQuotations: Tool = {
  name: 'list_quotations',
  description: 'List recent quotations with optional filters by company or status.',
  parameters: {
    type: 'object',
    properties: {
      companyId: { type: 'string', description: 'Filter by company' },
      status: {
        type: 'string',
        enum: ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED'],
        description: 'Filter by status',
      },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
  },
  execute: async (args) => {
    const where: Record<string, unknown> = {};
    if (args.companyId) where.companyId = args.companyId;
    if (args.status) where.status = args.status;
    return prisma.quotation.findMany({
      where,
      take: args.limit ?? 20,
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
  },
};

// ============================================================
// Tool: list_deals
// ============================================================
const listDeals: Tool = {
  name: 'list_deals',
  description: 'List sales deals in the pipeline, with optional filters by status, owner, or company.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['OPEN', 'WON', 'LOST'], description: 'Filter by status' },
      ownerId: { type: 'string', description: 'Filter by deal owner user ID' },
      companyId: { type: 'string', description: 'Filter by company' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
  },
  execute: async (args) => {
    const where: Record<string, unknown> = {};
    if (args.status) where.status = args.status;
    if (args.ownerId) where.ownerId = args.ownerId;
    if (args.companyId) where.companyId = args.companyId;
    return prisma.deal.findMany({
      where,
      take: args.limit ?? 20,
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        stage: { select: { name: true, probability: true } },
      },
    });
  },
};

// ============================================================
// Tool: draft_quotation
// ============================================================
const draftQuotation: Tool = {
  name: 'draft_quotation',
  description: 'Create a draft quotation for a company. Returns the new quotation ID. The quotation is saved as DRAFT status.',
  parameters: {
    type: 'object',
    properties: {
      companyId: { type: 'string', description: 'The customer company ID' },
      items: {
        type: 'array',
        description: 'Line items for the quotation',
        items: {
          type: 'object',
          properties: {
            productId: { type: 'string', description: 'Product ID (use search_products first if unsure)' },
            sku: { type: 'string' },
            name: { type: 'string' },
            quantity: { type: 'number' },
            unitPrice: { type: 'number' },
            discount: { type: 'number', description: 'Discount percentage (0-100)' },
          },
          required: ['name', 'quantity', 'unitPrice'],
        },
      },
      title: { type: 'string', description: 'Quotation title' },
      notes: { type: 'string', description: 'Internal notes' },
      taxRate: { type: 'number', description: 'Tax rate percentage (default 0)' },
      prompt: { type: 'string', description: 'The original user prompt that led to this draft (for AI audit trail)' },
    },
    required: ['companyId', 'items'],
  },
  execute: async (args, ctx) => {
    // Auto-generate next quotation number
    const year = new Date().getFullYear();
    const prefix = `Q-${year}-`;
    const last = await prisma.quotation.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
    });
    const lastSeq = last ? parseInt(last.number.slice(prefix.length), 10) : 0;
    const number = `${prefix}${(lastSeq + 1).toString().padStart(4, '0')}`;

    let subtotal = 0;
    const items = (args.items as any[]).map((it, idx) => {
      const qty = Number(it.quantity);
      const price = Number(it.unitPrice);
      const disc = Number(it.discount ?? 0);
      const lineTotal = qty * price * (1 - disc / 100);
      subtotal += lineTotal;
      return {
        productId: it.productId,
        sku: it.sku,
        name: it.name,
        quantity: qty,
        unitPrice: price,
        discount: disc,
        lineTotal,
        position: idx,
      };
    });
    const taxRate = Number(args.taxRate ?? 0);
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;

    const created = await prisma.quotation.create({
      data: {
        number,
        companyId: args.companyId,
        createdById: ctx.userId,
        title: args.title,
        notes: args.notes,
        subtotal,
        taxRate,
        taxAmount,
        total,
        generatedByAi: true,
        aiPrompt: args.prompt,
        items: { create: items },
      },
      include: { items: true, company: true },
    });
    return {
      quotationId: created.id,
      number: created.number,
      company: created.company.name,
      total,
      itemCount: created.items.length,
    };
  },
};

// ============================================================
// Tool: log_activity
// ============================================================
const logActivity: Tool = {
  name: 'log_activity',
  description: 'Log a sales activity (call, email, meeting, note) against a company, contact, or deal.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK'] },
      subject: { type: 'string' },
      body: { type: 'string' },
      companyId: { type: 'string' },
      contactId: { type: 'string' },
      dealId: { type: 'string' },
      dueAt: { type: 'string', description: 'ISO datetime for tasks' },
    },
    required: ['type', 'subject'],
  },
  execute: async (args, ctx) => {
    return prisma.activityLog.create({
      data: {
        type: args.type,
        subject: args.subject,
        body: args.body,
        companyId: args.companyId,
        contactId: args.contactId,
        dealId: args.dealId,
        assignedToId: ctx.userId,
        dueAt: args.dueAt ? new Date(args.dueAt) : null,
      },
    });
  },
};

// ============================================================
// Tool: get_top_customers
// ============================================================
const getTopCustomers: Tool = {
  name: 'get_top_customers',
  description: 'Get top customers ranked by total quotation value. Useful for revenue analysis.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Number of customers to return (default 5)' },
      statusFilter: {
        type: 'string',
        enum: ['all', 'accepted', 'invoiced'],
        description: 'Which quotation statuses to include in the total (default "all")',
      },
    },
  },
  execute: async (args) => {
    const limit = args.limit ?? 5;
    const statusFilter = args.statusFilter ?? 'all';
    const where: Record<string, unknown> = {};
    if (statusFilter === 'accepted') where.status = 'ACCEPTED';
    else if (statusFilter === 'invoiced') where.status = 'INVOICED';

    const grouped = await prisma.quotation.groupBy({
      by: ['companyId'],
      where,
      _sum: { total: true },
      _count: { id: true },
      orderBy: { _sum: { total: 'desc' } },
      take: limit,
    });
    // Hydrate company names
    const companyIds = grouped.map((g) => g.companyId);
    const companies = await prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true, industry: true },
    });
    const byId = new Map(companies.map((c) => [c.id, c]));
    return grouped.map((g) => ({
      companyId: g.companyId,
      companyName: byId.get(g.companyId)?.name ?? 'Unknown',
      industry: byId.get(g.companyId)?.industry,
      totalRevenue: g._sum.total ?? 0,
      quotationCount: g._count.id,
    }));
  },
};

export const toolRegistry: Tool[] = [
  searchCompanies,
  getCompany,
  searchProducts,
  listQuotations,
  listDeals,
  draftQuotation,
  logActivity,
  getTopCustomers,
];
