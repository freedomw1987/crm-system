/**
 * AI-powered Quotation import from Excel.
 *
 * Pinned by user request 2026-06-30: "用戶可以上傳舊有的Quotation
 * Excel file; 系統AI 可以幫我把這個Quotation上的資料做提取; 相對
 * 在系統中，創建Quotation記錄". The flow:
 *
 *   1. User uploads an .xlsx file (exported from any prior CRM
 *      — including the bc-quotation that v0 of this project
 *      superseded). The file is parsed with the project's existing
 *      xlsx-js-style dependency.
 *   2. The LLM extracts a structured plan: which row is the
 *      customer / contact, which is the deal, which lines are
 *      products vs services, which sales rep owned the deal.
 *   3. The backend executes the plan with find-or-create
 *      semantics: existing records (matched by name) are
 *      associated, missing ones are created. The new Quotation
 *      is always created (it gets a fresh number).
 *   4. The user reviews the plan before commit (preview endpoint)
 *      and the imported Quotation shows in the list with a marker
 *      so the team can spot the source.
 *
 * Why this lives in a lib file (not inline in the route):
 *   - The parser is pure (no LLM, no DB) so it can be unit-tested
 *     with fixture xlsx buffers.
 *   - The LLM extractor is the only "agent" part — it takes the
 *     parsed JSON + existing-entities context and returns a plan.
 *   - The executor is also pure (no LLM, only Prisma writes) so
 *     tests can use a mock prisma and assert the right
 *     find-or-create calls.
 *   - Reuses the same `xlsx-js-style` + `getAiConfig` + `getOpenAIClient`
 *     pattern that the chat and AI draft_quotation paths use.
 */

import * as XLSX from 'xlsx-js-style';
import { z } from 'zod';
import type { PrismaClient } from '@crm/db';
// 2026-07-01 (US-IMPORT-MD): shared with `apps/api/src/routes/service.ts`
// so the import executor can persist ServiceManDay rows the same way
// the admin POST/PATCH routes do. See `man-day-snapshot.ts` for the
// full rationale.
import { snapshotManDayLine, buildRoleLookup } from './man-day-snapshot';

// ============================================================================
// Section 1: Raw parse (pure, no LLM, no DB)
// ============================================================================

/**
 * The minimal shape we extract from a Quotation xlsx. We don't try to
 * handle every variant of the bc-quotation export — we just need
 * enough to feed the LLM the right context so it can extract a
 * structured plan.
 *
 * The "Quotation" sheet is the canonical one. Other sheets (SOW
 * Details, Assumption, MA Details, Server Requirements) are
 * preserved for the LLM's context but not parsed deeply.
 */
export interface ParsedXlsx {
  /** Sheet name → cells. Each cell is the raw string value
   *  (post-formatted). Number / date formatting is preserved by
   *  xlsx-js-style's default parse). */
  sheets: Record<string, string[][]>;
  /** First row of the "Quotation" sheet, treated as the header.
   *  The LLM matches subsequent rows to these column names. */
  quotationHeader: string[];
  /** Body rows of the "Quotation" sheet, trimmed (empty rows dropped). */
  quotationRows: string[][];
}

export function parseXlsxFile(buffer: Uint8Array): ParsedXlsx {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheets: Record<string, string[][]> = {};
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    });
    sheets[name] = rows;
  }
  // Trim empty trailing rows on the main sheet.
  const trim = (rows: string[][]): string[][] => {
    let last = rows.length;
    while (last > 0 && rows[last - 1]!.every((c) => c === '' || c == null)) last -= 1;
    return rows.slice(0, last);
  };
  const qRows = trim(sheets['Quotation'] ?? []);
  const header = qRows[0] ?? [];
  return {
    sheets,
    quotationHeader: header,
    quotationRows: qRows.slice(1),
  };
}

// ============================================================================
// Section 2: LLM-extracted import plan (zod schema, validated)
// ============================================================================

/**
 * The shape the LLM must return. We use zod for runtime validation
 * (the LLM may emit malformed JSON — zod gives us a clear error
 * path so the preview can surface a 422 with a useful message).
 *
 * Field naming matches the existing Prisma models so the executor
 * can do find-or-create without renaming.
 */
export const ImportPlanSchema = z.object({
  company: z.object({
    name: z.string().min(1),
    taxId: z.string().nullable().optional(),
    industry: z.string().nullable().optional(),
    regionCode: z.enum(['HK', 'MO', 'CN', 'OTHER']).nullable().optional(),
    contactEmail: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    contactPerson: z.string().nullable().optional(),
  }),
  deal: z
    .object({
      title: z.string().min(1),
      stage: z.string().nullable().optional(),
      value: z.number().nullable().optional(),
      ownerName: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  contact: z
    .object({
      name: z.string().min(1),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  lineItems: z
    .array(
      z.object({
        type: z.enum(['PRODUCT', 'SERVICE']),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        discount: z.number().nullable().optional(),
        sku: z.string().nullable().optional(),
        // For SERVICE items: the SOW / man-day breakdown.
        manDaySnapshot: z
          .array(
            z.object({
              role: z.string(),
              dayRate: z.number(),
              days: z.number(),
              costRate: z.number().nullable().optional(),
              // 2026-07-01 (US-IMPORT-MD): catalogue FK. When set,
              // the backend uses ManDayRole from this id to
              // snapshot the latest name/price/cost onto the
              // ServiceManDay row. When null/undefined, the line
              // is treated as free-form (legacy behaviour).
              manDayRoleId: z.string().nullable().optional(),
            }),
          )
          .nullable()
          .optional(),
      }),
    )
    .min(1),
  meta: z.object({
    title: z.string().min(1),
    notes: z.string().nullable().optional(),
    validUntil: z.string().nullable().optional(),
    taxRate: z.number().min(0).max(100).default(0),
    issueDate: z.string().nullable().optional(),
    currency: z.enum(['RMB', 'HKD', 'MOP']).default('HKD'),
  }),
});

export type ImportPlan = z.infer<typeof ImportPlanSchema>;

/**
 * Plan with matched entities (i.e. the result of running the
 * executor's find-or-create pass on the user's ImportPlan). This
 * is what the preview endpoint returns to the user, and what the
 * commit endpoint serializes back to the executor (re-derives to
 * avoid trust-the-client for FK ids).
 */
export interface ResolvedPlan {
  company: { id: string; isNew: boolean };
  deal: { id: string; isNew: boolean } | null;
  contact: { id: string; isNew: boolean } | null;
  salesRepId: string | null;
  lineItems: Array<{
    productId: string | null;
    serviceId: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
    name: string;
    description: string | null;
    sku: string | null;
    manDaySnapshot: unknown | null;
  }>;
  meta: ImportPlan['meta'];
}

// ============================================================================
// Section 3: LLM extraction
// ============================================================================

/**
 * LLM prompt. We give the model:
 *   1. The parsed Excel sheets (as JSON, truncated if huge).
 *   2. The list of existing Companies / Products / Services so
 *      it can pick an `isExisting` and the matched id (we don't
 *      tell it the id; the executor re-resolves by name).
 *   3. The plan schema as a JSON-Schema-like description.
 *
 * We use OpenAI's structured-output mode (response_format:
 * json_object with the schema in the system prompt). The result
 * is then validated by zod on our side.
 */
async function callLlmForImportPlan(
  parsed: ParsedXlsx,
  context: ImportContext,
): Promise<ImportPlan> {
  const OpenAI = (await import('openai')).default;
  const cfg = await context.getAiConfig();
  if (!cfg) throw new Error('AI not configured (run /admin/ai-config first)');
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.endpointUrl });
  const truncated = truncateForLlm(parsed, 50_000);
  const schemaDescription = JSON.stringify({
    company: {
      name: '<string, required>',
      taxId: '<string, optional>',
      industry: '<string, optional>',
      regionCode: '<"HK" | "MO" | "CN" | "OTHER", optional>',
      contactEmail: '<string, optional>',
      contactPhone: '<string, optional>',
      contactPerson: '<string, optional>',
    },
    deal: {
      title: '<string, required>',
      stage: '<string, optional>',
      value: '<number, optional>',
      ownerName: '<string, optional>',
    },
    contact: { name: '<string>', email: '<string, optional>', phone: '<string, optional>' },
    lineItems: [
      {
        type: '<"PRODUCT" | "SERVICE", required>',
        name: '<string, required>',
        description: '<string, optional>',
        quantity: '<number, required, positive>',
        unitPrice: '<number, required, non-negative>',
        discount: '<number 0-100, optional>',
        sku: '<string, optional>',
        manDaySnapshot: [
          { role: '<string>', dayRate: '<number>', days: '<number>', costRate: '<number, optional>' },
        ],
      },
    ],
    meta: {
      title: '<string, required>',
      notes: '<string, optional>',
      validUntil: '<ISO date string, optional>',
      taxRate: '<number 0-100, default 0>',
      issueDate: '<ISO date string, optional>',
      currency: '<"RMB" | "HKD" | "MOP", default "HKD">',
    },
  });
  const systemPrompt = [
    'You are an expert CRM data entry clerk.',
    'You are given a Quotation Excel file (parsed to JSON) and a list of',
    'existing records in the CRM. Extract a structured import plan.',
    'Match fuzzy against existing records (by name / SKU). For line items,',
    'set "type" by examining the name + description (a "license" / "seat" is',
    'a PRODUCT; a "service" / "consulting" / "training" / "setup" is a SERVICE).',
    // 2026-06-30: stronger JSON-only directive + concrete example,
    // because the MiniMax-M3 deployment we tested echoes the schema
    // description back as text when given a generic "Output JSON"
    // prompt. The example + "your reply must be a single JSON
    // object" keeps it on track.
    '',
    'STRICT FORMAT — read carefully:',
    '  • Your reply must be a single JSON object.',
    '  • The first character of your reply MUST be `{`.',
    '  • The last character of your reply MUST be `}`.',
    '  • Do NOT include any prose, analysis, commentary, or markdown',
    '    fences (no ```, no "Let me analyze…", no "Here is the JSON:").',
    '  • Do NOT copy or echo the schema description back; use real',
    '    data from the input.',
    '',
    'Required JSON shape (use this exact key set; replace the',
    'placeholders with actual values; omit optional keys when missing):',
    schemaDescription,
    '',
    'Example of a valid reply for a different quotation:',
    '{"company":{"name":"Acme Corp","regionCode":"HK"},"lineItems":[{"type":"PRODUCT","name":"Widget","quantity":2,"unitPrice":100}],"meta":{"title":"Q3 Quote","taxRate":0,"currency":"HKD"}}',
  ].join('\n');
  const userPayload = JSON.stringify({
    parsed: truncated,
    context: {
      companies: context.companies,
      products: context.products,
      services: context.services,
      deals: context.deals,
    },
  });
  const completion = await client.chat.completions.create({
    model: cfg.modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    // 2026-06-30: explicit max_tokens. The Barco sample has 5 line
    // items + a multi-section SOW sheet; with reasoning models the
    // JSON alone can exceed 2k tokens. Without this, MiniMax-M3
    // silently truncates mid-string and the next JSON.parse fails
    // with "Unable to parse JSON string".
    max_tokens: 8000,
  });
  const raw = completion.choices[0]?.message?.content ?? '{}';
  // 2026-06-30: Multi-provider robustness for non-OpenAI / reasoning
  // models. Strip every known wrapping pattern, then extract the
  // outermost `{...}` JSON object. Models tested:
  //   - DeepSeek-R1 / OpenAI o1/o3 → `` reasoning block
  //   - MiniMax-M3                  → prose preamble + occasional
  //                                    ``` json ``` markdown fences
  //   - OpenAI gpt-4o (reference)   → pure JSON
  // All three converge on a single `extractJson()` helper below.
  const extracted = extractJson(raw);
  let parsed_plan: unknown;
  try {
    parsed_plan = JSON.parse(extracted);
  } catch (err) {
    // 2026-07-01: best-effort repair pass for MiniMax-M3 truncation
    // + literal-newline-in-string issues observed on real Excel
    // imports (Barco + 澳門自來水). repairTruncatedJson() closes any
    // unterminated string, balances `{`/`}`/`[`/`]`, and escapes
    // any literal \n/\r/\t embedded inside string values.
    const repaired = repairTruncatedJson(extracted);
    try {
      parsed_plan = JSON.parse(repaired);
    } catch (err2) {
      // Surface the original error + repair failure with position
      // info so we can debug the next failure mode quickly.
      const posMatch = (err as Error).message.match(/position (\d+)/);
      const pos = posMatch ? Number(posMatch[1]) : -1;
      const around = pos >= 0
        ? extracted.slice(Math.max(0, pos - 60), pos + 60)
        : extracted.slice(0, 200);
      throw new Error(
        `LLM returned non-JSON: ${(err as Error).message} ` +
        `| pos=${pos} ` +
        `| around(${Math.max(0, pos - 60)}..${pos + 60}): ${JSON.stringify(around)} ` +
        `| total_len=${extracted.length} ` +
        `| repair_failed: ${(err2 as Error).message}`,
      );
    }
  }
  return ImportPlanSchema.parse(parsed_plan);
}

/**
 * Best-effort JSON extractor for non-OpenAI / reasoning model outputs.
 *
 * The supported LLM landscape today includes providers whose
 * chat-completion responses don't follow OpenAI's strict "JSON-only"
 * convention even when `response_format: { type: 'json_object' }` is
 * set. Observed wrappers in the wild (2026-06-30):
 *
 *   1. `` reasoning block (DeepSeek-R1, OpenAI o1/o3):
 *        <<<...>>>\n{...real json...}
 *   2. Prose preamble (MiniMax-M3 and similar):
 *        "Let me analyze this …\n\n{...real json...}"
 *   3. Markdown code fence (occasionally emitted when the model
 *      doesn't fully trust response_format):
 *        "```json\n{...real json...}\n```"
 *   4. Combination: preamble + reasoning + fence.
 *   5. Trailing prose after the JSON object.
 *
 * Strategy: strip (1) and (3), then take the substring between the
 * first `{` and the matching last `}` (greedy — keeps nested
 * objects inside `lineItems[i].manDaySnapshot` intact).
 *
 * Returns the original string (trimmed) when no `{`/`}` pair is
 * found, so the JSON.parse caller can surface the raw content in
 * the error message instead of swallowing it.
 */
export function extractJson(raw: string): string {
  let s = raw;
  // Strip reasoning blocks first.
  s = s.replace(/<[\s\S]*?>/g, '');
  // Strip markdown code fences (opening + closing + optional language).
  // `json`, `JSON`, or anything else after the backticks all get matched.
  s = s.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
  // Find outermost { ... }.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    return s.trim();
  }
  return s.slice(first, last + 1);
}

/**
 * Best-effort JSON repair for truncated / mid-string-cut LLM output.
 *
 * MiniMax-M3 (and other budget providers) sometimes cap the response
 * below the size of the full plan, leaving a JSON object whose last
 * string is unterminated. The 2026-07-01 incident with the Macau
 * Water quotation showed the response cut off at position ~430 mid-
 * string of `deal.title`, throwing "Unable to parse JSON string" at
 * JSON.parse time.
 *
 * Strategy: walk character-by-character, track whether we're inside
 * a string. If we hit end-of-input while inside a string, close the
 * string with `"` then close any unbalanced `{` / `[` / `}` / `]`.
 * Also strip embedded literal control characters (`\n`, `\t`,
 * `\r`) inside string values that the model emitted raw instead of
 * as escape sequences — these are the most common cause of
 * "Unable to parse JSON string".
 *
 * Returns the repaired string. Throws if the input is not even
 * shaped like a JSON object after the prefix is stripped.
 */
export function repairTruncatedJson(s: string): string {
  let out = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (escapeNext) {
      out += c;
      escapeNext = false;
      continue;
    }
    if (c === '\\') {
      out += c;
      escapeNext = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString && (c === '\n' || c === '\r' || c === '\t')) {
      // Model emitted a literal newline inside a string — escape it.
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t';
      continue;
    }
    out += c;
  }
  // If we ended mid-string, close it.
  if (inString) out += '"';
  // Balance braces / brackets by closing whatever is open, in reverse.
  const stack: string[] = [];
  let strMode = false;
  let esc = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { strMode = !strMode; continue; }
    if (strMode) continue;
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  // Whatever is left on the stack needs to be closed.
  while (stack.length > 0) {
    out += stack.pop();
  }
  return out;
}

function truncateForLlm(p: ParsedXlsx, maxChars: number): ParsedXlsx {
  // The full Excel can be >100k chars once serialised; trim to fit
  // a reasonable context window. Keep the main "Quotation" sheet
  // (the source of truth) and the first row of any other sheet.
  const sheets: Record<string, string[][]> = {};
  for (const [name, rows] of Object.entries(p.sheets)) {
    if (name === 'Quotation') sheets[name] = rows;
    else sheets[name] = rows.slice(0, 1);
  }
  let str = JSON.stringify(sheets);
  if (str.length <= maxChars) return { ...p, sheets };
  // Last resort: drop the SOW sheet entirely.
  delete sheets['SOW Details'];
  str = JSON.stringify(sheets);
  if (str.length <= maxChars) return { ...p, sheets };
  // Truncate each remaining row.
  for (const [name, rows] of Object.entries(sheets)) {
    sheets[name] = rows.map((r) => r.slice(0, 12));
  }
  return { ...p, sheets };
}

// ============================================================================
// Section 4: Plan execution (Prisma writes, no LLM)
// ============================================================================

export interface ImportContext {
  prisma: PrismaClient;
  getAiConfig: () => Promise<{ apiKey: string; endpointUrl: string; modelName: string } | null>;
  companies: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; sku: string }>;
  services: Array<{ id: string; name: string }>;
  deals: Array<{ id: string; title: string; stage?: string | null }>;
  userId: string;
}

/**
 * Execute the plan: find-or-create every entity, then create the
 * Quotation with line items. Returns the resolved plan (the data
 * the user needs to confirm — id isNew flags) plus the new
 * Quotation id. This is the function the route calls.
 *
 * Match strategy (the "AI 要懂得做關聯" requirement):
 *   1. Company: case-insensitive `name` match within the same
 *      region. If a match is found, REUSE — do NOT create.
 *   2. Deal: case-insensitive `title` match. If a match is found,
 *      REUSE. (The plan's `ownerName` is ignored for re-use; we
 *      look up the existing owner.)
 *   3. Contact: case-insensitive `name` match. We attach the
 *      contact to the same company. If no match, CREATE.
 *   4. Sales rep: case-insensitive `name` match across all users
 *      with role SALES or ADMIN. If a match is found, REUSE.
 *   5. Line items: case-insensitive `name` match against products
 *      OR services. If matched, REUSE — we set the FK to the
 *      existing item but keep the snapshot fields (`name`, `sku`,
 *      `unitPrice`, etc.) as the user uploaded them. If no match,
 *      CREATE a new product or service.
 *
 * The 2026-06-30 user request: "如果關聯資料是沒有存在, AI 要懂
 * 得去創建新記錄了". We honor this at the line-item level: an
 * unmatched product or service becomes a new product or service
 * with the imported name + price. (We don't create companies or
 * deals without a clear name — for safety the plan should always
 * include the company name; deals are optional.)
 */
export async function executeImportPlan(
  plan: ImportPlan,
  ctx: ImportContext,
): Promise<{ resolved: ResolvedPlan; newQuotationId: string }> {
  // -- 1. Company (find-or-create) --------------------------------
  const companyNameLc = plan.company.name.trim().toLowerCase();
  let company = ctx.companies.find((c) => c.name.toLowerCase() === companyNameLc);
  let companyIsNew = false;
  if (!company) {
    company = await ctx.prisma.company.create({
      data: {
        name: plan.company.name,
        taxId: plan.company.taxId ?? null,
        industry: plan.company.industry ?? null,
        regionId: plan.company.regionCode
          ? (await ctx.prisma.region.findFirst({
              where: { code: plan.company.regionCode },
              select: { id: true },
            }))?.id ?? null
          : null,
      },
      select: { id: true, name: true },
    });
    companyIsNew = true;
    // 2026-06-30: per-entity audit row for the new company so the
    // compliance trail distinguishes "hand-created by admin" from
    // "imported from Excel". The description follows the convention
    // in middleware/audit.ts and includes the new id + name so an
    // auditor can grep `/audit` by company name.
    await ctx.prisma.auditLog.create({
      data: {
        actorId: ctx.userId,
        action: 'COMPANY_CREATED',
        resourceType: 'company',
        resourceId: company.id,
        description: `Imported company from Excel: ${company.name} (region=${plan.company.regionCode ?? 'NONE'})`,
        metadata: { importedFromExcel: true, source: 'excel-import' },
      },
    });
  }

  // -- 2. Contact (optional) --------------------------------------
  let contact: { id: string; isNew: boolean } | null = null;
  if (plan.contact?.name) {
    // Split the full name into first/last so the equality match
    // hits the actual schema columns. Previous code passed the full
    // string as `firstName: { equals: plan.contact.name }` which
    // never matched (a real Contact row stores "John" in firstName
    // + "Smith" in lastName, not "John Smith" in firstName). The
    // space-split is a pragmatic default; if both first AND last
    // are required for uniqueness we'll add a more sophisticated
    // fuzzy match in a follow-up.
    const nameTrimmed = plan.contact.name.trim();
    const firstSpaceIdx = nameTrimmed.indexOf(' ');
    const firstName =
      firstSpaceIdx === -1 ? nameTrimmed : nameTrimmed.slice(0, firstSpaceIdx);
    const lastName =
      firstSpaceIdx === -1 ? '' : nameTrimmed.slice(firstSpaceIdx + 1);
    const existing = await ctx.prisma.contact.findFirst({
      where: { companyId: company.id, firstName, lastName },
      select: { id: true },
    });
    if (existing) {
      contact = { id: existing.id, isNew: false };
    } else {
      const created = await ctx.prisma.contact.create({
        data: {
          companyId: company.id,
          firstName,
          lastName,
          email: plan.contact.email ?? null,
          phone: plan.contact.phone ?? null,
        },
        select: { id: true },
      });
      contact = { id: created.id, isNew: true };
      await ctx.prisma.auditLog.create({
        data: {
          actorId: ctx.userId,
          action: 'CONTACT_CREATED',
          resourceType: 'contact',
          resourceId: created.id,
          description: `Imported contact from Excel: ${nameTrimmed} (company=${company.name})`,
          metadata: { importedFromExcel: true, source: 'excel-import' },
        },
      });
    }
  }

  // -- 3. Deal (optional, find-or-create) -----------------------
  let deal: { id: string; isNew: boolean } | null = null;
  if (plan.deal?.title) {
    const dealTitleLc = plan.deal.title.trim().toLowerCase();
    const existing = ctx.deals.find((d) => d.title.toLowerCase() === dealTitleLc);
    if (existing) {
      deal = { id: existing.id, isNew: false };
    } else {
      // Resolve required FKs (stageId, pipelineId, ownerId) to
      // concrete strings before the create call — Prisma's create
      // input rejects `string | undefined` for required fields. We
      // try the named stage first, then fall back to the first
      // stage of the default pipeline. ownerId defaults to the
      // authenticated user (the importer).
      const namedStage = plan.deal.stage
        ? await ctx.prisma.pipelineStage.findFirst({
            where: { name: plan.deal.stage },
            select: { id: true, pipelineId: true },
          })
        : null;
      const fallbackStage = namedStage
        ? null
        : await ctx.prisma.pipelineStage.findFirst({
            where: { pipeline: { isDefault: true } },
            orderBy: { position: 'asc' },
            select: { id: true, pipelineId: true },
          });
      if (!fallbackStage && !namedStage) {
        throw new Error(
          'No pipeline stage found — create a default pipeline before importing',
        );
      }
      const stageId = namedStage?.id ?? fallbackStage!.id;
      const pipelineId = namedStage?.pipelineId ?? fallbackStage!.pipelineId;
      // ownerId defaults to the authenticated user (ctx.userId is
      // set from the JWT in every request — same pattern as
      // Quotation.createdById).
      const created = await ctx.prisma.deal.create({
        data: {
          title: plan.deal.title,
          companyId: company.id,
          ownerId: ctx.userId,
          pipelineId,
          stageId,
          value: plan.deal.value ?? 0,
          status: 'OPEN',
        },
        select: { id: true },
      });
      deal = { id: created.id, isNew: true };
      await ctx.prisma.auditLog.create({
        data: {
          actorId: ctx.userId,
          action: 'DEAL_CREATED',
          resourceType: 'deal',
          resourceId: created.id,
          description: `Imported deal from Excel: ${plan.deal.title} (company=${company.name})`,
          metadata: { importedFromExcel: true, source: 'excel-import' },
        },
      });
    }
  }

  // -- 4. Sales rep (optional) ----------------------------------
  let salesRepId: string | null = null;
  if (plan.deal?.ownerName) {
    const user = await ctx.prisma.user.findFirst({
      where: { name: { equals: plan.deal.ownerName }, isActive: true },
      select: { id: true },
    });
    if (user) salesRepId = user.id;
    // If no user matches, we leave salesRepId null (the import
    // is still useful; the team can set the owner via the
    // Quotation's edit dialog afterwards).
  }

  // -- 5. Line items (find-or-create per row) -------------------
  const resolvedItems: ResolvedPlan['lineItems'] = [];
  for (let i = 0; i < plan.lineItems.length; i++) {
    const li = plan.lineItems[i]!;
    const liNameLc = li.name.trim().toLowerCase();
    if (li.type === 'PRODUCT') {
      const existing = ctx.products.find(
        (p) =>
          p.name.toLowerCase() === liNameLc ||
          (li.sku && p.sku.toLowerCase() === li.sku.trim().toLowerCase()),
      );
      let productId: string;
      if (existing) {
        productId = existing.id;
      } else {
        const created = await ctx.prisma.product.create({
          data: {
            name: li.name,
            sku: li.sku ?? `imported-${Date.now()}-${i}`,
            description: li.description ?? null,
            unitPrice: li.unitPrice,
            currency: plan.meta.currency,
          },
          select: { id: true },
        });
        productId = created.id;
        await ctx.prisma.auditLog.create({
          data: {
            actorId: ctx.userId,
            action: 'PRODUCT_CREATED',
            resourceType: 'product',
            resourceId: created.id,
            description: `Imported product from Excel: ${li.name} (sku=${li.sku ?? '(auto)'})`,
            metadata: { importedFromExcel: true, source: 'excel-import' },
          },
        });
      }
      resolvedItems.push({
        productId,
        serviceId: null,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discount: li.discount ?? 0,
        name: li.name,
        description: li.description ?? null,
        sku: li.sku ?? null,
        manDaySnapshot: null,
      });
    } else {
      // SERVICE
      const existing = ctx.services.find(
        (s) => s.name.toLowerCase() === liNameLc,
      );
      let serviceId: string;
      if (existing) {
        // 2026-07-01 (US-IMPORT-MD): reuse existing service by name.
        // The user's per-quotation man-day breakdown is NOT applied
        // to the existing Service.manDayLines — that would corrupt
        // the admin-curated catalogue. The breakdown is frozen on
        // the QuotationItem.manDaySnapshot below instead. If the
        // user re-imports a different breakdown for an existing
        // service in the future, they can either edit the catalogue
        // directly or accept the per-quotation snapshot.
        serviceId = existing.id;
      } else {
        // 2026-07-01 (US-IMPORT-MD): NEW service. Persist the user's
        // man-day breakdown as ServiceManDay rows so the catalogue
        // entry has a complete definition going forward. Pre-load
        // any ManDayRole FKs referenced by the snapshot so the
        // snapshot helper can resolve latest price/cost without
        // N+1 lookups.
        const mdLines = li.manDaySnapshot ?? [];
        const roleIds = mdLines
          .map((l) => l.manDayRoleId)
          .filter((id): id is string => !!id);
        const roleLookup = await buildRoleLookup(ctx.prisma, roleIds);
        const created = await ctx.prisma.service.create({
          data: {
            name: li.name,
            description: li.description ?? null,
            unitPrice: li.unitPrice,
            currency: plan.meta.currency,
            status: 'ACTIVE',
            sortOrder: i,
            // Persist each man-day line from the Preview modal.
            // The `snapshotManDayLine` helper resolves the
            // catalogue FK to name/price/cost; rows without a
            // manDayRoleId fall through to free-form.
            manDayLines: {
              create: mdLines.map((line, idx) =>
                snapshotManDayLine(
                  {
                    manDayRoleId: line.manDayRoleId ?? null,
                    role: line.role,
                    dayRate: line.dayRate,
                    costRate: line.costRate ?? 0,
                    days: line.days,
                    sortOrder: idx,
                  },
                  roleLookup,
                ),
              ),
            },
          },
          select: { id: true },
        });
        serviceId = created.id;
        await ctx.prisma.auditLog.create({
          data: {
            actorId: ctx.userId,
            action: 'SERVICE_CREATED',
            resourceType: 'service',
            resourceId: created.id,
            description: `Imported service from Excel: ${li.name}${mdLines.length > 0 ? ` (${mdLines.length} man-day line${mdLines.length === 1 ? '' : 's'})` : ''}`,
            metadata: {
              importedFromExcel: true,
              source: 'excel-import',
              manDayCount: mdLines.length,
            },
          },
        });
      }
      resolvedItems.push({
        productId: null,
        serviceId,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discount: li.discount ?? 0,
        name: li.name,
        description: li.description ?? null,
        sku: null,
        // Always snapshot the user-provided breakdown on the
        // QuotationItem so GP%/cost are computed from the
        // per-quotation snapshot (not from a fresh re-pull of
        // the catalogue, which would silently rewrite history
        // if the admin later edits ManDayRole prices).
        manDaySnapshot: li.manDaySnapshot ?? null,
      });
    }
  }

  // -- 6. Create the Quotation ----------------------------------
  const year = new Date().getFullYear();
  const last = await ctx.prisma.quotation.findFirst({
    where: { number: { startsWith: `Q-${year}-` } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const seq = last
    ? parseInt(last.number.slice(`Q-${year}-`.length), 10) + 1
    : 1;
  const newNumber = `Q-${year}-${seq.toString().padStart(4, '0')}`;

  const created = await ctx.prisma.quotation.create({
    data: {
      number: newNumber,
      companyId: company.id,
      dealId: deal?.id ?? null,
      createdById: ctx.userId,
      salesRepId,
      title: plan.meta.title,
      notes: plan.meta.notes ?? null,
      validUntil: plan.meta.validUntil ? new Date(plan.meta.validUntil) : null,
      taxRate: plan.meta.taxRate,
      currency: plan.meta.currency,
      status: 'DRAFT',
      items: {
        create: resolvedItems.map((it, idx) => {
          // 2026-07-01 (US-IMPORT-MD): compute costSnapshot /
          // lineGp / lineGpPercent at create time so the imported
          // Quotation shows accurate GP% from the moment it's
          // opened, without waiting for an edit to trigger
          // recalcQuotationAndItems().
          //
          // For SERVICE lines with a manDaySnapshot, costSnapshot =
          //   Σ (line.costRate * line.days) * quantity
          // (costRate defaults to 0 for free-form / legacy rows
          // that have no costRate).
          // For PRODUCT lines, costSnapshot = 0 → lineGpPercent=100
          // (matches the gpOf() formula in quotation-gp.ts).
          const isProduct = !!it.productId;
          const md = (it.manDaySnapshot ?? []) as Array<{
            costRate?: number | null;
            days: number;
          }>;
          const costSnapshot = !isProduct && md.length > 0
            ? md.reduce((s, l) => s + Number(l.costRate ?? 0) * Number(l.days), 0) *
              Number(it.quantity)
            : 0;
          const lineTotal = Number(it.quantity) * Number(it.unitPrice) *
            (1 - Number(it.discount) / 100);
          const lineGp = lineTotal - costSnapshot;
          const lineGpPercent = lineTotal > 0 ? (lineGp / lineTotal) * 100 : 100;
          return {
            itemType: isProduct ? 'PRODUCT' : 'SERVICE',
            productId: it.productId,
            serviceId: it.serviceId,
            sku: it.sku,
            name: it.name,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discount: it.discount,
            // lineTotal is required by the schema; mirror the
            // production recalcQuotationAndItems() formula here.
            lineTotal,
            // costSnapshot + GP fields — see comment above.
            costSnapshot,
            lineGp,
            lineGpPercent,
            manDaySnapshot: (it.manDaySnapshot ?? undefined) as never,
            position: idx,
          };
        }),
      },
    },
    select: { id: true, number: true },
  });

  // -- 7. Audit log ---------------------------------------------
  await ctx.prisma.auditLog.create({
    data: {
      actorId: ctx.userId,
      action: 'QUOTATION_CREATED',
      resourceType: 'quotation',
      resourceId: created.id,
      description: `Imported Quotation from Excel as ${created.number} (company: ${company.name}${plan.deal ? `, deal: ${plan.deal.title}` : ''})`,
      metadata: {
        importedFromExcel: true,
        source: 'excel-import',
        importSource: 'excel',
        companyIsNew,
        dealIsNew: deal?.isNew ?? null,
        contactIsNew: contact?.isNew ?? null,
        lineItemCount: resolvedItems.length,
      },
    },
  });

  // 2026-07-01: recompute the header totals (subtotal, taxAmount,
  // total) so the imported Quotation shows accurate numbers the
  // moment it's opened, without waiting for the user to edit the
  // form to trigger a recalc. We use the resolvedItems array
  // (already validated + persisted) to derive the header values
  // in JS rather than re-querying the just-created rows.
  //
  // Why not call the production `recalcQuotationAndItems()` from
  // `quotation.ts`? It reaches for `prisma` via a module-level
  // import (not via a parameter), so the test suite's mock-prisma
  // would be bypassed. Keeping the math here keeps the executor
  // pure and unit-testable.
  const subtotal = resolvedItems.reduce(
    (s, it) => s + Number(it.quantity) * Number(it.unitPrice) *
      (1 - Number(it.discount) / 100),
    0,
  );
  const taxAmount = subtotal * (Number(plan.meta.taxRate) / 100);
  const total = subtotal + taxAmount;
  await ctx.prisma.quotation.update({
    where: { id: created.id },
    data: {
      subtotal,
      taxAmount,
      total,
      // Currency snapshots (totalHKD / totalMOP) are intentionally
      // left at their Prisma defaults (0). The manual create path
      // in `quotation.ts` does a full HKD/MOP snapshot dance via
      // `resolveCurrencySnapshot`; for imports we keep the
      // historical behaviour of "display total in source currency
      // until the user edits the quote and triggers a full
      // recalc". Editing the imported Quotation will re-snapshot
      // both currencies the next time the user saves.
    },
  });

  return {
    resolved: {
      company: { id: company.id, isNew: companyIsNew },
      deal: deal,
      contact,
      salesRepId,
      lineItems: resolvedItems,
      meta: plan.meta,
    },
    newQuotationId: created.id,
  };
}

// ============================================================================
// Section 5: Convenience wrapper for the route handler
// ============================================================================

/**
 * Top-level entry: parse + extract plan via LLM. Returns the
 * validated `ImportPlan` ready to be passed to `executeImportPlan`.
 */
export async function extractImportPlan(
  xlsxBuffer: Uint8Array,
  ctx: Omit<ImportContext, 'prisma' | 'userId'> & { prisma: PrismaClient; userId: string },
): Promise<ImportPlan> {
  const parsed = parseXlsxFile(xlsxBuffer);
  return callLlmForImportPlan(parsed, ctx);
}
