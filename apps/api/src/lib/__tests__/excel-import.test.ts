/**
 * Regression tests for `excel-import.ts` (Day 30).
 *
 * Pinned invariants (mirrors the comment header in the lib):
 *   - `parseXlsxFile(buf)` extracts the "Quotation" sheet into a
 *     canonical form: header row + body rows. The other sheets
 *     (SOW / Assumption / etc.) are preserved verbatim and
 *     passed to the LLM as additional context.
 *   - `ImportPlanSchema` (zod) rejects:
 *     * unknown `lineItems[].type` (must be PRODUCT | SERVICE)
 *     * taxRate out of [0, 100]
 *     * quantity / unitPrice that aren't positive / non-negative
 *   - `executeImportPlan(plan, ctx)` with a mock prisma does
 *     find-or-create on every entity (company / deal / line items)
 *     and respects the `isNew` flag in the `ResolvedPlan` returned.
 *
 * The LLM call itself is NOT tested here (it requires a live
 * OpenAI key). The LLM boundary is covered in the import route
 * test (when added); the executor and parser are deterministic
 * enough to test in isolation here.
 */

import { describe, it, expect } from 'bun:test';
import * as XLSX from 'xlsx-js-style';
import {
  ImportPlanSchema,
  parseXlsxFile,
  extractJson,
  repairTruncatedJson,
  type ImportPlan,
  type ImportContext,
  type ResolvedPlan,
} from '../excel-import';
import type { PrismaClient } from '@crm/db';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal but realistic Quotation xlsx in memory. The shape
 * mirrors the bc-quotation v0 export: 5 sheets, the canonical
 * "Quotation" sheet at the top with the main header + body rows.
 */
function buildFixtureXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new();
  // Main "Quotation" sheet — header in row 1, line items below.
  // The lib's parser is key-position-based: col 0 = name, col 1 = sku,
  // col 2 = quantity, col 3 = unit price, col 4 = discount,
  // col 5 = type (PRODUCT | SERVICE), col 6 = description.
  const quotationRows = [
    ['Name', 'SKU', 'Quantity', 'Unit Price', 'Discount', 'Type', 'Description'],
    ['ClickShare CX-50', 'Barco-CX-50', 2, 12000, 0, 'PRODUCT', 'Wireless presentation hub'],
    ['Senior Engineer Implementation', '', 10, 5000, 0, 'SERVICE', '10-day installation'],
  ];
  const quotationSheet = XLSX.utils.aoa_to_sheet(quotationRows);
  XLSX.utils.book_append_sheet(wb, quotationSheet, 'Quotation');
  // Other sheets — kept verbatim, no parsing applied to them
  // in the lib (the LLM does the column-name mapping).
  const sowRows = [['Role', 'Day Rate', 'Days', 'Subtotal']];
  const sowSheet = XLSX.utils.aoa_to_sheet(sowRows);
  XLSX.utils.book_append_sheet(wb, sowSheet, 'SOW Details');
  // Return as bytes (Buffer-ish); the lib expects Uint8Array.
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(buf);
}

/** Build a Prisma mock that records every call we care about. */
function buildPrismaMock(): {
  prisma: PrismaClient;
  calls: {
    companyFindMany: any[][];
    companyCreate: any[][];
    productFindMany: any[][];
    productCreate: any[][];
    serviceFindMany: any[][];
    serviceCreate: any[][];
    dealFindMany: any[][];
    dealCreate: any[][];
    quotationCreate: any[][];
    pipelineStageFindFirst: any[][];
    userFindFirst: any[][];
    regionFindFirst: any[][];
    manDayRoleFindMany: any[][];
  };
  auditCreate: any[][];
} {
  const calls = {
    companyFindMany: [] as any[][],
    companyCreate: [] as any[][],
    productFindMany: [] as any[][],
    productCreate: [] as any[][],
    serviceFindMany: [] as any[][],
    serviceCreate: [] as any[][],
    dealFindMany: [] as any[][],
    dealCreate: [] as any[][],
    quotationCreate: [] as any[][],
    pipelineStageFindFirst: [] as any[][],
    userFindFirst: [] as any[][],
    regionFindFirst: [] as any[][],
    manDayRoleFindMany: [] as any[][],
    auditCreate: [] as any[][],
  };
  const prisma = {
    company: {
      findMany: async (...args: any[]) => {
        calls.companyFindMany.push(args);
        return [];
      },
      create: async (args: any) => {
        calls.companyCreate.push([args]);
        return { id: 'co_new', ...args.data };
      },
    },
    product: {
      findMany: async (...args: any[]) => {
        calls.productFindMany.push(args);
        return [];
      },
      create: async (args: any) => {
        calls.productCreate.push([args]);
        return { id: 'pr_new', ...args.data };
      },
    },
    service: {
      findMany: async (...args: any[]) => {
        calls.serviceFindMany.push(args);
        return [];
      },
      create: async (args: any) => {
        calls.serviceCreate.push([args]);
        return { id: 'sv_new', ...args.data };
      },
    },
    deal: {
      findMany: async (...args: any[]) => {
        calls.dealFindMany.push(args);
        return [];
      },
      create: async (args: any) => {
        calls.dealCreate.push([args]);
        return { id: 'dl_new', ...args.data };
      },
    },
    quotation: {
      findFirst: async () => null, // for nextQuotationNumber()
      create: async (args: any) => {
        calls.quotationCreate.push([args]);
        return { id: 'q_new', number: 'Q-2099-0001', ...args.data };
      },
      // 2026-07-01: header-total recompute after create (so the
      // imported Quotation shows accurate subtotal/tax/total
      // without requiring a user edit to trigger a recalc).
      update: async (args: any) => {
        return { id: args.where.id, ...args.data };
      },
    },
    // 2026-07-01 (US-IMPORT-MD): mock for the new man-day role
    // lookup path. Default returns empty (legacy free-form mode)
    // so existing tests aren't disturbed. Tests that exercise
    // the FK → catalogue snapshot path override this.
    manDayRole: {
      findMany: async (...args: any[]) => {
        calls.manDayRoleFindMany.push(args);
        return [];
      },
    },
    pipelineStage: {
      findFirst: async (...args: any[]) => {
        calls.pipelineStageFindFirst.push(args);
        return { id: 'st_default', pipelineId: 'pl_default' };
      },
    },
    user: {
      findFirst: async (...args: any[]) => {
        calls.userFindFirst.push(args);
        return null;
      },
    },
    region: {
      findFirst: async (...args: any[]) => {
        calls.regionFindFirst.push(args);
        return null;
      },
    },
    auditLog: {
      create: async (args: any) => {
        calls.auditCreate.push([args]);
        return { id: 'al_1', ...args.data };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls, auditCreate: calls.auditCreate };
}

function basePlan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    company: { name: 'ACME Corp' },
    lineItems: [
      {
        type: 'PRODUCT',
        name: 'ClickShare CX-50',
        quantity: 2,
        unitPrice: 12000,
      },
    ],
    meta: {
      title: 'Q2 Upgrade Quote',
      taxRate: 0,
      currency: 'HKD',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseXlsxFile
// ---------------------------------------------------------------------------

describe('parseXlsxFile', () => {
  it('extracts the "Quotation" sheet header + body rows', () => {
    const buf = buildFixtureXlsx();
    const parsed = parseXlsxFile(buf);
    expect(parsed.quotationHeader).toEqual([
      'Name', 'SKU', 'Quantity', 'Unit Price', 'Discount', 'Type', 'Description',
    ]);
    expect(parsed.quotationRows).toHaveLength(2);
    expect(parsed.quotationRows[0]).toContain('ClickShare CX-50');
    expect(parsed.quotationRows[1]).toContain('Senior Engineer Implementation');
    expect(parsed.quotationRows[1]).toContain('SERVICE');
  });

  it('preserves every sheet for LLM context', () => {
    const buf = buildFixtureXlsx();
    const parsed = parseXlsxFile(buf);
    expect(Object.keys(parsed.sheets).sort()).toEqual([
      'Quotation',
      'SOW Details',
    ]);
  });

  it('returns empty header + body when there is no Quotation sheet', () => {
    // Build a workbook with only an irrelevant sheet.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['a', 'b'], ['1', '2']]),
      'OtherSheet',
    );
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const parsed = parseXlsxFile(new Uint8Array(buf));
    expect(parsed.quotationHeader).toEqual([]);
    expect(parsed.quotationRows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ImportPlanSchema (zod)
// ---------------------------------------------------------------------------

describe('ImportPlanSchema (zod validation)', () => {
  it('accepts a minimal valid plan', () => {
    const result = ImportPlanSchema.parse(basePlan());
    expect(result.company.name).toBe('ACME Corp');
    expect(result.lineItems).toHaveLength(1);
  });

  it('rejects lineItems with an unknown type', () => {
    const bad = {
      ...basePlan(),
      lineItems: [{ type: 'WHATEVER', name: 'X', quantity: 1, unitPrice: 1 }],
    } as unknown;
    expect(() => ImportPlanSchema.parse(bad)).toThrow();
  });

  it('rejects taxRate out of [0, 100]', () => {
    expect(() =>
      ImportPlanSchema.parse(basePlan({ meta: { title: 'x', taxRate: 101, currency: 'HKD' } })),
    ).toThrow();
    expect(() =>
      ImportPlanSchema.parse(basePlan({ meta: { title: 'x', taxRate: -1, currency: 'HKD' } })),
    ).toThrow();
  });

  it('rejects negative quantity / negative unitPrice', () => {
    expect(() =>
      ImportPlanSchema.parse(basePlan({ lineItems: [
        { type: 'PRODUCT', name: 'X', quantity: -1, unitPrice: 1 },
      ] })),
    ).toThrow();
    expect(() =>
      ImportPlanSchema.parse(basePlan({ lineItems: [
        { type: 'PRODUCT', name: 'X', quantity: 1, unitPrice: -5 },
      ] })),
    ).toThrow();
  });

  it('requires a non-empty lineItems array', () => {
    expect(() =>
      ImportPlanSchema.parse(basePlan({ lineItems: [] })),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// executeImportPlan (mocked prisma)
// ---------------------------------------------------------------------------

describe('executeImportPlan', () => {
  it('find-or-creates the company on a fresh import', async () => {
    const { prisma, calls } = buildPrismaMock();
    const ctx: ImportContext = {
      prisma,
      getAiConfig: () => null,
      companies: [],
      products: [],
      services: [],
      deals: [],
      userId: 'user_1',
    };
    const result = await executeImportPlanForTest(basePlan(), ctx);
    expect(calls.companyCreate).toHaveLength(1);
    expect(calls.companyCreate[0]?.[0]?.data?.name).toBe('ACME Corp');
    expect(result.resolved.company).toEqual({ id: 'co_new', isNew: true });
  });

  it('does not create a company when one already matches by name', async () => {
    const { prisma, calls } = buildPrismaMock();
    (prisma.company.findMany as any) = async () => [
      { id: 'co_existing', name: 'ACME Corp' },
    ];
    const ctx: ImportContext = {
      prisma,
      getAiConfig: () => null,
      companies: [{ id: 'co_existing', name: 'ACME Corp' }],
      products: [],
      services: [],
      deals: [],
      userId: 'user_1',
    };
    const result = await executeImportPlanForTest(basePlan(), ctx);
    expect(calls.companyCreate).toHaveLength(0);
    expect(result.resolved.company).toEqual({ id: 'co_existing', isNew: false });
  });

  it('creates a new product when no match by name or SKU', async () => {
    const { prisma, calls } = buildPrismaMock();
    const ctx: ImportContext = {
      prisma,
      getAiConfig: () => null,
      companies: [],
      products: [],
      services: [],
      deals: [],
      userId: 'user_1',
    };
    const plan = basePlan({
      lineItems: [
        {
          type: 'PRODUCT',
          name: 'New Gadget',
          quantity: 1,
          unitPrice: 999,
          sku: undefined,
        },
      ],
    });
    const result = await executeImportPlanForTest(plan, ctx);
    expect(calls.productCreate).toHaveLength(1);
    expect(calls.productCreate[0]?.[0]?.data?.name).toBe('New Gadget');
    expect(result.resolved.lineItems[0]?.productId).toBe('pr_new');
  });

  it('reuses an existing product matched by SKU', async () => {
    const { prisma, calls } = buildPrismaMock();
    (prisma.product.findMany as any) = async () => [
      { id: 'pr_match', name: 'MATCH BY SKU', sku: 'EXISTING-SKU' },
    ];
    const ctx: ImportContext = {
      prisma,
      getAiConfig: () => null,
      companies: [],
      products: [{ id: 'pr_match', name: 'MATCH BY SKU', sku: 'EXISTING-SKU' }],
      services: [],
      deals: [],
      userId: 'user_1',
    };
    const plan = basePlan({
      lineItems: [
        {
          type: 'PRODUCT',
          name: 'Anything',
          quantity: 1,
          unitPrice: 100,
          sku: 'EXISTING-SKU',
        },
      ],
    });
    const result = await executeImportPlanForTest(plan, ctx);
    expect(calls.productCreate).toHaveLength(0);
    expect(result.resolved.lineItems[0]?.productId).toBe('pr_match');
  });

  it('writes the import audit log with the source + counts', async () => {
    const { prisma, calls } = buildPrismaMock();
    const ctx: ImportContext = {
      prisma,
      getAiConfig: () => null,
      companies: [],
      products: [],
      services: [],
      deals: [],
      userId: 'user_1',
    };
    const plan = basePlan({ meta: { title: 'A', taxRate: 0, currency: 'HKD' } });
    await executeImportPlanForTest(plan, ctx);
    // 2026-06-30: per-entity audits (COMPANY_CREATED + PRODUCT_CREATED)
    // are written alongside the QUOTATION_CREATED row so the compliance
    // trail distinguishes imports from hand-created entities.
    const actions = calls.auditCreate.map(([d]) => d?.data?.action);
    expect(actions).toContain('QUOTATION_CREATED');
    expect(actions).toContain('COMPANY_CREATED');
    expect(actions).toContain('PRODUCT_CREATED');
    // The QUOTATION_CREATED row carries the importSource + counts.
    const quotationRow = calls.auditCreate.find(
      ([d]) => d?.data?.action === 'QUOTATION_CREATED',
    )?.[0]?.data;
    expect(quotationRow?.metadata?.companyIsNew).toBe(true);
    expect(quotationRow?.metadata?.importedFromExcel).toBe(true);
    expect(quotationRow?.metadata?.lineItemCount).toBe(1);
  });

  it('does NOT write a COMPANY_CREATED audit when reusing an existing company', async () => {
    const { prisma, calls } = buildPrismaMock();
    const ctx: ImportContext = {
      prisma,
      getAiConfig: () => null,
      companies: [{ id: 'co_existing', name: 'ACME Corp' }],
      products: [],
      services: [],
      deals: [],
      userId: 'user_1',
    };
    await executeImportPlanForTest(basePlan(), ctx);
    const actions = calls.auditCreate.map(([d]) => d?.data?.action);
    expect(actions).not.toContain('COMPANY_CREATED');
    expect(actions).toContain('QUOTATION_CREATED');
  });

  // 2026-07-01 (US-IMPORT-MD): the three new tests below lock in
  // the SERVICE branch's behaviour around man-day persistence:
  //   1. NEW service with manDaySnapshot → ServiceManDay rows
  //      created via `service.create({ data: { ..., manDayLines:
  //      { create: [...] } } })`. Snapshot helper resolves
  //      ManDayRole.price/cost when an FK is set.
  //   2. EXISTING service with manDaySnapshot → do NOT mutate
  //      the catalogue. The user's man-day breakdown lives only
  //      on QuotationItem.manDaySnapshot (frozen JSON).
  //   3. Schema accepts `manDayRoleId` in manDaySnapshot items
  //      so the Preview modal can ship an FK alongside the
  //      legacy free-form shape.

  it('persists manDayLines when creating a NEW service (with ManDayRole FK snapshot)', async () => {
    const { prisma, calls } = buildPrismaMock();
    // Mock the ManDayRole catalogue to resolve the FK used in
    // the snapshot below. The executor calls
    // `prisma.manDayRole.findMany` via buildRoleLookup.
    (prisma.manDayRole.findMany as any) = async () => [
      { id: 'role_se', name: 'Senior Engineer', price: 5000, cost: 3000 },
    ];
    const ctx: ImportContext = {
      prisma,
      getAiConfig: () => null,
      companies: [],
      products: [],
      services: [],
      deals: [],
      userId: 'user_1',
    };
    const plan: ImportPlan = basePlan({
      lineItems: [
        {
          type: 'SERVICE',
          name: 'Senior Engineering Implementation',
          quantity: 1,
          unitPrice: 100000,
          manDaySnapshot: [
            { role: 'Senior Engineer', manDayRoleId: 'role_se', dayRate: 5000, days: 10, costRate: 3000 },
          ],
        },
      ],
      meta: { title: 'M', taxRate: 0, currency: 'HKD' },
    });
    await executeImportPlanForTest(plan, ctx);
    // 1. The new service was created
    expect(calls.serviceCreate).toHaveLength(1);
    // 2. The nested `manDayLines.create` was passed in
    const createArgs = calls.serviceCreate[0]?.[0];
    const manDayLines = createArgs?.data?.manDayLines?.create;
    expect(Array.isArray(manDayLines)).toBe(true);
    expect(manDayLines).toHaveLength(1);
    // 3. The snapshot helper resolved the catalogue: dayRate
    //    came from ManDayRole.price (5000), costRate from
    //    ManDayRole.cost (3000), role from ManDayRole.name.
    expect(manDayLines[0]).toMatchObject({
      manDayRoleId: 'role_se',
      role: 'Senior Engineer',
      dayRate: 5000,
      costRate: 3000,
      days: 10,
      sortOrder: 0,
    });
    expect(manDayLines[0].subtotal).toBe(50000); // 5000 * 10
    // 4. The audit row records the man-day count.
    const svcAudit = calls.auditCreate.find(
      ([d]) => d?.data?.action === 'SERVICE_CREATED',
    )?.[0]?.data;
    expect(svcAudit?.metadata?.manDayCount).toBe(1);
  });

  it('does NOT mutate an existing service — man-day breakdown lives only on QuotationItem', async () => {
    const { prisma, calls } = buildPrismaMock();
    // Pre-existing service: name match. The executor should reuse
    // by id and NOT issue a service.create call, even if the
    // plan carries a manDaySnapshot.
    const ctx: ImportContext = {
      prisma,
      getAiConfig: () => null,
      companies: [],
      products: [],
      services: [{ id: 'sv_existing', name: 'Pre-existing Service' }],
      deals: [],
      userId: 'user_1',
    };
    const plan: ImportPlan = basePlan({
      lineItems: [
        {
          type: 'SERVICE',
          name: 'Pre-existing Service',
          quantity: 1,
          unitPrice: 999,
          manDaySnapshot: [
            { role: 'Override Role', manDayRoleId: null, dayRate: 999, days: 5, costRate: 100 },
          ],
        },
      ],
      meta: { title: 'M', taxRate: 0, currency: 'HKD' },
    });
    const result = await executeImportPlanForTest(plan, ctx);
    // No service.create was issued — catalogue is unchanged.
    expect(calls.serviceCreate).toHaveLength(0);
    // The QuotationItem DID carry the man-day breakdown (frozen).
    expect(result.resolved.lineItems[0]?.manDaySnapshot).toEqual([
      { role: 'Override Role', manDayRoleId: null, dayRate: 999, days: 5, costRate: 100 },
    ]);
    // QuotationItem costSnapshot was computed from the snapshot:
    // Σ(costRate * days) * qty = 100*5*1 = 500
    const qItem = calls.quotationCreate[0]?.[0]?.data?.items?.create?.[0];
    expect(qItem?.costSnapshot).toBe(500);
    // GP% = (lineTotal - cost) / lineTotal = (999 - 500) / 999 ≈ 49.95%
    expect(qItem?.lineGp).toBe(499);
    expect(qItem?.lineGpPercent).toBeCloseTo(49.95, 1);
  });

  it('ImportPlanSchema accepts manDayRoleId in manDaySnapshot items', () => {
    // Forward-compat: the Preview UI may emit `{ role, dayRate,
    // days, costRate, manDayRoleId }`. The zod schema must accept
    // it without rejection.
    const result = ImportPlanSchema.parse(basePlan({
      lineItems: [
        {
          type: 'SERVICE',
          name: 'Test',
          quantity: 1,
          unitPrice: 100,
          manDaySnapshot: [
            { role: 'r', manDayRoleId: 'role_x', dayRate: 100, days: 1, costRate: 0 },
          ],
        },
      ],
    }));
    expect(result.lineItems[0]?.manDaySnapshot?.[0]?.manDayRoleId).toBe('role_x');
  });
});

// ---------------------------------------------------------------------------
// extractJson — strips reasoning blocks + markdown fences + finds outermost {}
// ---------------------------------------------------------------------------

describe('extractJson', () => {
  it('returns pure JSON unchanged', () => {
    const pure = '{"a":1,"b":2}';
    expect(extractJson(pure)).toBe(pure);
  });

  it('strips a <<<...>>> reasoning block (DeepSeek-R1 style)', () => {
    const raw = '<<<\nLet me analyze...\n>>>{"a":1,"b":2}';
    expect(extractJson(raw)).toBe('{"a":1,"b":2}');
  });

  it('strips a "Let me analyze" prose preamble (MiniMax style)', () => {
    const raw = 'Let me analyze this and extract the plan.\n\n{"a":1,"b":2}';
    expect(extractJson(raw)).toBe('{"a":1,"b":2}');
  });

  it('strips ```json markdown code fences', () => {
    const raw = '```json\n{"a":1,"b":2}\n```';
    expect(extractJson(raw)).toBe('{"a":1,"b":2}');
  });

  it('strips prose + reasoning + fence combined', () => {
    const raw = 'Let me think.\n<<<\nreasoning\n>>>\n```json\n{"a":1}\n```';
    expect(extractJson(raw)).toBe('{"a":1}');
  });

  it('drops trailing prose after the JSON object', () => {
    const raw = '{"a":1,"b":2}\n\nNote: this is a great plan!';
    expect(extractJson(raw)).toBe('{"a":1,"b":2}');
  });

  it('handles nested braces inside lineItems[i].description', () => {
    const raw = '{"x":[{"y":"a{b}c"}]} trailing junk';
    expect(extractJson(raw)).toBe('{"x":[{"y":"a{b}c"}]}');
  });

  it('returns the trimmed string when no JSON braces are found', () => {
    const raw = '  no json here  ';
    expect(extractJson(raw)).toBe('no json here');
  });
});

// ---------------------------------------------------------------------------
// repairTruncatedJson — closes mid-string cuts + balances braces
// ---------------------------------------------------------------------------

describe('repairTruncatedJson', () => {
  it('closes a string cut at the end of input', () => {
    const truncated = '{"deal":{"title":"智慧客戶';
    expect(JSON.parse(repairTruncatedJson(truncated))).toEqual({
      deal: { title: '智慧客戶' },
    });
  });

  it('closes nested braces after the last complete entry', () => {
    const truncated = '{"items":[{"type":"PRODUCT","name":"Widget","quantity":1';
    const repaired = repairTruncatedJson(truncated);
    const parsed = JSON.parse(repaired);
    expect(parsed.items[0].name).toBe('Widget');
    expect(parsed.items[0].quantity).toBe(1);
  });

  it('escapes literal newlines embedded inside string values', () => {
    const raw = '{"note":"line one\nline two"}';
    // Buggy JSON: raw \n inside string is invalid.
    expect(() => JSON.parse(raw)).toThrow();
    const repaired = repairTruncatedJson(raw);
    const parsed = JSON.parse(repaired);
    expect(parsed.note).toBe('line one\nline two');
  });

  it('escapes literal tabs and carriage returns inside strings', () => {
    const raw = '{"note":"a\tb\rc"}';
    const repaired = repairTruncatedJson(raw);
    expect(JSON.parse(repaired)).toEqual({ note: 'a\tb\rc' });
  });

  it('leaves well-formed JSON unchanged', () => {
    const good = '{"a":"b","c":1}';
    expect(repairTruncatedJson(good)).toBe(good);
  });

  it('preserves legitimate backslash escapes (e.g. \\n)', () => {
    const raw = '{"note":"a\\nb"}';
    expect(repairTruncatedJson(raw)).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Test-only wrapper
// ---------------------------------------------------------------------------

/**
 * The lib's `executeImportPlan` returns a value that's destructured
 * in tests as `{ resolved, newQuotationId }`. We re-import here
 * (rather than at the top) to keep the test wrapper close to the
 * tests that use it.
 */
async function executeImportPlanForTest(plan: ImportPlan, ctx: ImportContext) {
  const { executeImportPlan } = await import('../excel-import');
  return executeImportPlan(plan, ctx) as Promise<{
    resolved: ResolvedPlan;
    newQuotationId: string;
  }>;
}
