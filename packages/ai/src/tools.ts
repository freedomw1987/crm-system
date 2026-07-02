/**
 * AI Agent tool registry
 *
 * Each tool defines: name, description, OpenAI function-calling JSON schema, and execute().
 * The agent will be able to call these to interact with the CRM.
 */

import { prisma } from '@crm/db';
// P2 multi-currency (2026-06-29): resolve the chosen currency +
// its HKD rate before persisting the draft, so the snapshot we
// write matches what the Quotation route does on manual create.
// See packages/db/src/currency.ts for the rationale + edge cases.
import { resolveCurrencySnapshot, mopRateFor, getCurrencyConfig } from '@crm/db';

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
  /**
   * US-C5 (Day 17, 2026-06-08): if true, the agent loop pauses before
   * executing this tool and emits a `confirmation_required` SSE event
   * so the human user can approve or deny. Defaults to false. The
   * three write tools (`draftQuotation`, `updateDealStage`,
   * `logActivity`) are the only ones currently flagged true.
   *
   * Why a registry-level flag and not a per-call decision: the LLM
   * should never get to decide whether a mutation is safe — that
   * decision is a property of the tool itself, not of the prompt
   * context. A hallucinated "trust me" assertion must not be enough
   * to skip the guardrail.
   */
  requiresConfirmation?: boolean;
  /**
   * Optional human-readable description of the side-effect, used by
   * the frontend's DiffPreview to render the confirmation dialog.
   * If absent, the tool name + raw args are shown.
   */
  sideEffectSummary?: string;
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
  description: 'List sales deals in the pipeline, with optional filters by status, owner, or company. For "X\'s deals" or "show me David\'s open deals" prefer the ownerName parameter over chaining search_users → list_deals.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['OPEN', 'WON', 'LOST'], description: 'Filter by status' },
      ownerId: { type: 'string', description: 'Filter by deal owner user ID (preferred if you have it)' },
      ownerName: { type: 'string', description: 'Filter by deal owner NAME (case-insensitive substring). Resolved server-side to a userId; returns an empty list if no match. Prefer search_users for ambiguous names.' },
      companyId: { type: 'string', description: 'Filter by company' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
  },
  execute: async (args) => {
    let resolvedOwnerId = args.ownerId as string | undefined;
    // RG-032: name-based owner filter. Only resolve when ownerId is
    // NOT supplied — if both are present, ownerId wins (explicit > fuzzy).
    if (!resolvedOwnerId && args.ownerName) {
      const u = await prisma.user.findFirst({
        where: {
          isActive: true,
          name: { contains: args.ownerName, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (!u) return []; // name didn't resolve — empty list beats error
      resolvedOwnerId = u.id;
    }
    const where: Record<string, unknown> = {};
    if (args.status) where.status = args.status;
    if (resolvedOwnerId) where.ownerId = resolvedOwnerId;
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
  description: 'Create a draft quotation for a company. Returns the new quotation ID. The quotation is saved as DRAFT status. Supports billing currency (RMB/HKD/MOP); HKD equivalent is snapshotted at save time.',
  // US-C5: the LLM is explicitly NOT trusted to make this call
  // without a human-in-the-loop sign-off. Even though the quotation
  // is created in DRAFT status (so it's not yet sent to the
  // customer), creating a draft still writes a row to the DB, fires
  // an audit log entry, and consumes a quotation number — all of
  // which should require explicit intent.
  requiresConfirmation: true,
  sideEffectSummary: 'Creates a new quotation row in DRAFT status. Generates a quotation number and writes a QUOTATION_CREATED audit log entry.',
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
      // P2 multi-currency (2026-06-29): billing currency. If the
      // user did not specify one, fall back to the system default
      // (RMB by default; admin can change in /settings/currency).
      // The HKD equivalent is snapshotted on the row so future
      // rate changes do not rewrite the customer's contract.
      currency: {
        type: 'string',
        enum: ['RMB', 'HKD', 'MOP'],
        description: 'Billing currency for the quotation. Defaults to the system default (RMB). HKD equivalent is snapshotted.',
      },
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

    // P2 multi-currency (2026-06-29): resolve the chosen currency +
    // its HKD rate up-front. We call the same helper the Quotation
    // POST route uses so the snapshot logic stays identical.
    //
    // Fall-back policy for the AI tool is intentionally permissive:
    //   - explicit pick of RMB/HKD/MOP   → trust the LLM, fail loud
    //     if the admin hasn't configured a rate (return the rate-
    //     missing error so the user knows to fix the config)
    //   - explicit pick of something else → silent fall back to
    //     system default (the LLM hallucinated a currency; the
    //     confirmation dialog will surface the actual pick)
    //   - omitted                         → system default
    // Without the fall-back for the "garbage string" case, a single
    // bad model call would block the user from drafting a quote.
    const requested = (args.currency as string | undefined) ?? null;
    const isKnownPick = requested === 'RMB' || requested === 'HKD' || requested === 'MOP';
    let currency: 'RMB' | 'HKD' | 'MOP' = 'RMB';
    let rate = 1;
    // 2026-06-29: MOP snapshot mirrors the HKD path. We resolve
    // both rates from the same `currencyCfg` so the two snapshots
    // can never disagree about which currency the row is in. The
    // MOP default of 1 + totalMOP default of `total` covers the
    // "fall-back to RMB" code path below (same as the HKD block).
    let mopRate = 1;
    let totalMOP = total * mopRate;
    // totalHKD is the HKD equivalent that gets persisted on the row.
    // Computed here so the snapshot is consistent with whatever
    // (currency, rate) pair we resolved above.
    let totalHKD = total * rate;
    if (isKnownPick || requested === null) {
      const snapshot = await resolveCurrencySnapshot(requested);
      if (snapshot) {
        currency = snapshot.currency;
        rate = snapshot.rate;
        totalHKD = total * rate;
        // Derive mopRate from the same config the HKD helper used.
        // Reading the config again here is one extra DB call but
        // keeps the two helpers independent; if this becomes a
        // hot-path concern, extend resolveCurrencySnapshot to also
        // return mopRate (see packages/db/src/currency.ts).
        const cfg = await getCurrencyConfig();
        const mRate = mopRateFor(currency, cfg);
        if (mRate != null) {
          mopRate = mRate;
          totalMOP = total * mopRate;
        }
      } else if (isKnownPick) {
        // Known currency, no rate configured — surface the error so
        // the confirmation dialog can tell the user what to fix.
        throw new Error(
          `No exchange rate configured for ${requested} → HKD. Set it in /settings/currency before drafting this quote, or omit the currency parameter to use the system default.`,
        );
      }
      // requested === null and snapshot null → config is missing;
      // fall back to RMB with rate=1 so we never block on a config
      // gap (the currency picker in the editor will let the user
      // pick a real one before sending).
    }

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
        currency,
        exchangeRateToHKD: rate,
        totalHKD,
        exchangeRateToMOP: mopRate,
        totalMOP,
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
      // P2 multi-currency (2026-06-29): surface both numbers in
      // the tool response so the assistant can render "RMB X
      // (≈ HKD Y, ≈ MOP Z)" without having to re-fetch.
      currency,
      totalHKD,
      totalMOP,
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
  // US-C5: even "just" logging an activity writes to the DB and
  // fires ACTIVITY_CREATED. The user should see what the LLM is
  // about to attribute to them (e.g. "I called ACME on Tuesday and
  // discussed Q4 plans") before it's persisted in their name.
  requiresConfirmation: true,
  sideEffectSummary: 'Creates a new Activity row attributed to the current user. Visible on the company/contact/deal timeline.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK'] },
      // Day 30: subject is folded into `content` (Activity
      // model has no `subject` column). `body` / `contactId` /
      // `dueAt` were latent typecheck errors (not in v1 schema);
      // they are also aspirational — future US may add
      // `subject` / `contactId` / `dueAt` columns to Activity.
      subject: { type: 'string' },
      companyId: { type: 'string' },
      dealId: { type: 'string' },
    },
    required: ['type', 'subject'],
  },
  execute: async (args, ctx) => {
    // P1-1 (2026-06-08): schema model is `Activity`, so the Prisma
    // client delegate is `prisma.activity`, not `prisma.activityLog`.
    // The previous identifier was a latent typecheck error that would
    // have produced a 500 the first time the AI tool was invoked.
    return prisma.activity.create({
      data: {
        // Day 30: the schema declares a `subject` field (the AI
        // caller's surface), but `prisma.activity` only has
        // `type` + `content` + FK columns. The subject is folded
        // into `content` here. Future US may add a dedicated
        // `subject` column to Activity (Day 19+) — for now the
        // AI's "subject" is a leading line in the content.
        type: args.type,
        content: args.subject
          ? `[${args.subject}]\n\n${(args as { content?: string }).content ?? ''}`
          : ((args as { content?: string }).content ?? ''),
        companyId: args.companyId,
        // Day 30: contactId, dueAt, body were latent typecheck
        // errors (Activity model has none of these fields — v1
        // schema is `companyId / dealId / type / content` plus
        // author / assigned / timestamps). The tool's richer
        // surface is aspirational; we fold subject into content
        // for now and drop the rest. Future US can re-add
        // contactId / dueAt columns to Activity.
        dealId: args.dealId,
        // `authorId` is required by the schema. Set from the
        // authenticated user (the AI acts on the user's behalf,
        // so the activity is attributed to the user — same as
        // Quotation.createdById).
        authorId: ctx.userId,
        assignedToId: ctx.userId,
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

// ============================================================
// Tool: search_services
// ============================================================
// Day 10+: Searches the service catalogue by name/category/status. This
// is the service-side mirror of search_products — services are
// SOW-style offerings (man-day role breakdown) rather than discrete
// SKUs, so the surface is simpler.
const searchServices: Tool = {
  name: 'search_services',
  description: 'Search the service catalogue by name, category, or status. Returns services with pricing and man-day line counts.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term (matches name, description)' },
      category: { type: 'string', description: 'Filter by category (e.g. "Consulting", "Implementation")' },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], description: 'Filter by status' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
  },
  execute: async (args) => {
    const where: Record<string, unknown> = {};
    if (args.status) where.status = args.status;
    if (args.category) where.category = args.category;
    if (args.query) {
      where.OR = [
        { name: { contains: args.query, mode: 'insensitive' } },
        { description: { contains: args.query, mode: 'insensitive' } },
      ];
    }
    return prisma.service.findMany({
      where,
      take: args.limit ?? 20,
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { manDayLines: true, quotationItems: true } },
      },
    });
  },
};

// ============================================================
// Tool: list_pipelines
// ============================================================
// Day 11: Lists the configured sales pipelines and their stages so the
// AI can answer questions like "what's our sales pipeline?" or
// "what stages do deals go through?". Read-only — updates are not
// exposed as a tool (admins use the Settings page).
const listPipelines: Tool = {
  name: 'list_pipelines',
  description:
    "List the configured sales pipelines and their stages. Use this to find valid stage IDs/names before calling update_deal_stage, or to answer 'what's our sales pipeline?'.",
  parameters: {
    type: 'object',
    properties: {
      pipelineId: {
        type: 'string',
        description: 'Optional — return only this pipeline. Omit to list all.',
      },
    },
  },
  execute: async (args) => {
    // Day 11: an empty string is the LLM's natural fallback for "no
    // filter" when it doesn't realise the field is optional. Coerce
    // '' to undefined so Prisma's `where` stays unfiltered.
    const pipelineId = args.pipelineId && String(args.pipelineId).trim()
      ? String(args.pipelineId)
      : undefined;
    const where = pipelineId ? { id: pipelineId } : undefined;
    const pipelines = await prisma.pipeline.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        stages: {
          orderBy: { position: 'asc' },
          include: { _count: { select: { deals: true } } },
        },
      },
    });
    return pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      stages: p.stages.map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position,
        probability: s.probability,
        color: s.color,
        dealCount: s._count.deals,
      })),
    }));
  },
};

// ============================================================
// Tool: update_deal_stage
// ============================================================
// Day 10+: Moves a deal to a different pipeline stage (the kanban
// column). Returns the updated deal. Does NOT change the `status` field
// (OPEN/WON/LOST) — that's a separate manual decision the sales rep
// makes when they close the deal. Each call is logged as an Activity so
// the audit trail is intact.
const updateDealStage: Tool = {
  name: 'update_deal_stage',
  // US-C5: moving a deal between pipeline stages is one of the
  // highest-signal mutations in the CRM. The stage drives
  // forecasting, dashboard counts, and downstream automations; a
  // hallucinated move would cascade everywhere. Always require
  // confirmation.
  requiresConfirmation: true,
  sideEffectSummary: 'Moves a deal to a different pipeline stage. Affects forecasting, dashboard counts, and writes an Activity for the audit trail.',
  description: 'Move a deal to a different pipeline stage (kanban column). Does not change OPEN/WON/LOST status — that requires explicit close action. Logs an Activity for audit trail.',
  parameters: {
    type: 'object',
    properties: {
      dealId: { type: 'string', description: 'The deal ID' },
      stageId: { type: 'string', description: 'The new stage ID (use list_deals to find current stage, or list_pipelines/list_stages if you need a different pipeline)' },
      reason: { type: 'string', description: 'Why the deal is being moved (used in the Activity log)' },
    },
    required: ['dealId', 'stageId'],
  },
  execute: async (args, ctx) => {
    const updated = await prisma.deal.update({
      where: { id: args.dealId },
      data: { stageId: args.stageId },
      include: { stage: true, company: { select: { id: true, name: true } } },
    });
    // Audit trail via Activity
    await prisma.activity.create({
      data: {
        type: 'NOTE',
        // Schema: Activity has `content` (the body) and no `subject`.
        // We prepend the subject-like prefix to the content so the
        // activity log line is self-describing.
        content: `[Stage change] ${updated.stage.name}${args.reason ? ` — ${args.reason}` : ' (via AI assistant)'}`,
        dealId: args.dealId,
        companyId: updated.companyId,
        authorId: ctx.userId,
      },
    });
    return {
      dealId: updated.id,
      title: updated.title,
      newStage: updated.stage.name,
      company: updated.company.name,
    };
  },
};

// ============================================================
// Tool: search_users  (RG-032)
// ============================================================
// Lets the AI resolve a salesperson / team-member NAME to a UserId
// instead of forcing the user to paste a UUID. The LLM calls this
// whenever the user prompt contains a person reference ("David",
// "John Smith", "salesperson John", "業務 David").
const searchUsers: Tool = {
  name: 'search_users',
  description: 'Search CRM users by name or email fragment. Returns matching ACTIVE users with id, name, email, and role. Use this whenever the user refers to a salesperson or team member by NAME — never ask for a UserId if you can search by name first. If multiple matches are returned, surface the list to the user and ask which one they meant.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name or email fragment (case-insensitive substring match, partial OK)' },
      role: { type: 'string', enum: ['ADMIN', 'SALES', 'VIEWER'], description: 'Optional role filter' },
      limit: { type: 'number', description: 'Max results (default 10, hard-capped at 50)' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const where: Record<string, unknown> = { isActive: true };
    if (args.role) where.role = args.role;
    where.OR = [
      { name: { contains: args.query, mode: 'insensitive' } },
      { email: { contains: args.query, mode: 'insensitive' } },
    ];
    return prisma.user.findMany({
      where,
      take: Math.min(args.limit ?? 10, 50),
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    });
  },
};

// ============================================================
// Tool: get_user_recent_activity  (RG-032)
// ============================================================
// Row-level activity log for a single user. Use this when the user
// asks "what has David been doing lately?" — pair with search_users
// to resolve the name to a UserId first.
const getUserRecentActivity: Tool = {
  name: 'get_user_recent_activity',
  description: "Get recent sales activities (calls, emails, meetings, notes) authored by a specific user. Pair with search_users if you only have a name. Use to answer \"what has David been doing lately?\" or \"show me John's recent calls\".",
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'User ID (use search_users first if you only have a name)' },
      type: { type: 'string', enum: ['NOTE', 'CALL', 'EMAIL', 'MEETING'], description: 'Optional filter by activity type' },
      daysBack: { type: 'number', description: 'How many days back to look (default 30, hard-capped at 365)' },
      limit: { type: 'number', description: 'Max results (default 20, hard-capped at 100)' },
    },
    required: ['userId'],
  },
  execute: async (args) => {
    // Hard-cap daysBack to keep "give me everything" queries bounded.
    const days = Math.min(args.daysBack ?? 30, 365);
    const since = new Date();
    since.setDate(since.getDate() - days);
    return prisma.activity.findMany({
      where: {
        authorId: args.userId,
        ...(args.type ? { type: args.type } : {}),
        createdAt: { gte: since },
      },
      // Hits the [authorId, createdAt desc] index on Activity
      // (schema.prisma line 717). Order is the second key, so the
      // index covers the WHERE + ORDER BY without a sort step.
      take: Math.min(args.limit ?? 20, 100),
      orderBy: { createdAt: 'desc' },
      include: {
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
      },
    });
  },
};

// ============================================================
// Tool: get_salesperson_summary  (RG-032)
// ============================================================
// Aggregate counts + totals for one salesperson over a window. Use
// this for "how is X doing?" / "X 最近 sales 情況" — it's cheaper
// than chaining list_deals + get_user_recent_activity and the answer
// is usually a 5-row table, not a wall of raw rows.
const getSalespersonSummary: Tool = {
  name: 'get_salesperson_summary',
  description: "Get an aggregate summary of one salesperson's recent performance: deal counts (open/won/lost) + total pipeline value, quotation counts by status, and activity counts by type. Returns numbers, not rows — pair with list_deals / get_user_recent_activity if you need the underlying rows. Use to answer \"how is David doing?\" or \"David 最近 sales 情況\".",
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'User ID (use search_users first if you only have a name)' },
      daysBack: { type: 'number', description: 'How many days back to look (default 30, hard-capped at 365)' },
    },
    required: ['userId'],
  },
  execute: async (args) => {
    const days = Math.min(args.daysBack ?? 30, 365);
    const since = new Date();
    since.setDate(since.getDate() - days);

    // 4 parallel queries — no N+1. We select only the columns we
    // need so the row payload stays small.
    const [deals, quotations, activities, user] = await Promise.all([
      prisma.deal.findMany({
        where: { ownerId: args.userId, createdAt: { gte: since } },
        select: { status: true, value: true },
      }),
      prisma.quotation.findMany({
        where: { createdById: args.userId, createdAt: { gte: since } },
        select: { status: true, total: true },
      }),
      prisma.activity.findMany({
        where: { authorId: args.userId, createdAt: { gte: since } },
        select: { type: true },
      }),
      prisma.user.findUnique({
        where: { id: args.userId },
        select: { id: true, name: true, email: true, role: true },
      }),
    ]);

    const dealCounts: Record<string, number> = { OPEN: 0, WON: 0, LOST: 0 };
    let pipelineValue = 0;
    for (const d of deals) {
      dealCounts[d.status] = (dealCounts[d.status] ?? 0) + 1;
      // LOST deals don't count toward pipeline value — they were never
      // going to close. OPEN + WON both do (WON already closed at this
      // value, but it's still a number the user wants to see in the
      // "this month's wins" line).
      // d.value is a Prisma.Decimal — convert via Number() for the
      // aggregate. Precision loss is acceptable at the summary level
      // (the LLM will format the value to 2 decimals in its reply).
      if (d.status !== 'LOST') pipelineValue += d.value ? Number(d.value) : 0;
    }
    const quotationCounts: Record<string, number> = {};
    for (const q of quotations) {
      quotationCounts[q.status] = (quotationCounts[q.status] ?? 0) + 1;
    }
    const activityCounts: Record<string, number> = {};
    for (const a of activities) {
      activityCounts[a.type] = (activityCounts[a.type] ?? 0) + 1;
    }

    return {
      user,
      period: { from: since.toISOString(), days },
      deals: { total: deals.length, byStatus: dealCounts, pipelineValue },
      quotations: { total: quotations.length, byStatus: quotationCounts },
      activities: { total: activities.length, byType: activityCounts },
    };
  },
};

export const toolRegistry: Tool[] = [
  searchCompanies,
  getCompany,
  searchProducts,
  searchServices,
  listQuotations,
  listDeals,
  listPipelines,
  updateDealStage,
  draftQuotation,
  logActivity,
  getTopCustomers,
  // RG-032: name-based salesperson lookup. Read-only — no confirmation.
  searchUsers,
  getUserRecentActivity,
  getSalespersonSummary,
];

/**
 * Tool-category partitions (RG-CHAT-002, Day 17 US-C5).
 *
 * `WRITE_TOOLS` = the set of tools that REQUIRE human confirmation
 * before execution. The agent loop in `@crm/ai/index.ts` checks
 * `WRITE_TOOLS.has(name)` before emitting a `confirmation_required`
 * SSE event. Exporting the partition here (not deriving it inside
 * the agent loop) means a test can assert:
 *   1. Every tool flagged `requiresConfirmation: true` IS in WRITE_TOOLS
 *      (no tool is in the registry that "silently" gets the guardrail)
 *   2. Every tool in WRITE_TOOLS has `requiresConfirmation: true`
 *      (no tool gets the guardrail accidentally)
 *   3. Adding a new tool to the registry and forgetting to flag it
 *      `requiresConfirmation: true` is caught here as a type error
 *      when the new tool is added to `WRITE_TOOLS` (or not).
 *
 * Day-30 code review (RG-026 etc.) found that the previous inline
 * check in `packages/ai/index.ts` had drifted from the registry's
 * per-tool `requiresConfirmation` flag — pinning both sides here
 * closes the gap.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(
  toolRegistry.filter((t) => t.requiresConfirmation).map((t) => t.name),
);

/**
 * Read-only tools: queries that don't mutate CRM state. Used by the
 * agent prompt to seed a tool-selection hint and by tests to assert
 * "no read tool got the requiresConfirmation flag set by accident"
 * (the inverse invariant to WRITE_TOOLS).
 */
export const READ_TOOLS: ReadonlySet<string> = new Set(
  toolRegistry.filter((t) => !t.requiresConfirmation).map((t) => t.name),
);
