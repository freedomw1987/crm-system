/**
 * Canonical `PATCH /quotations/:id` body shape.
 *
 * Pinned by:
 *   - RG-020 (P2-quotation-deal-link): PATCH must accept + persist
 *     `dealId` (frontend builder must send it; backend typecast must
 *     read it).
 *   - RG-021 (P2-sales-rep follow-up): PATCH must accept
 *     `salesRepId`. `dealId` is NOT in the SENT lock (CRM metadata,
 *     editable across the lifecycle). `salesRepId` is delta-only —
 *     omitted when unchanged so the audit log doesn't churn with
 *     no-op diffs.
 *
 * Why this lives in a lib file (not inline in the route): the
 * `apps/api/src/routes/quotation.ts:670-695` PATCH body typecast
 * is a free-form `as { ... }` (no `t.Object` validator — see
 * RG-024 for the planned validator). Centralising the shape here
 * gives us a single source of truth that the route typecast aligns
 * with, and lets tests assert the field-level invariants without
 * spinning up Elysia + Prisma.
 *
 * The frontend (`apps/web/src/components/quotation-builder.tsx`)
 * keeps its inline PATCH body — the type here is the contract the
 * backend expects. If a future PR adds a frontend import, the
 * cleanest path is a re-export from `@crm/shared`.
 */

export interface QuotationPatchBody {
  /** Editable everywhere (DRAFT or non-DRAFT). `null` clears. */
  title?: string;
  notes?: string;
  /** `null` clears the valid-until. */
  validUntil?: string | null;
  /** 0-100 percentage. `null` is invalid (use 0). */
  taxRate?: number;
  /** DRAFT-only (SENT lock covers this). `null` detaches from any Deal. */
  dealId?: string | null;
  /** CRM metadata — NOT in SENT lock. Omit when unchanged so audit
   *  log doesn't churn. `null` clears. */
  salesRepId?: string | null;
  /** DRAFT-only (SENT lock covers this — Day 19 multi-currency). */
  currency?: string;
  /** Mutating status. Always allowed (no SENT lock); the route's
   *  own status-transition rules (e.g. rejecting SENT if a SERVICE
   *  line has costSnapshot == 0) still apply. */
  status?: string;
}

/**
 * Fields that are in the SENT lock (cannot be changed on a
 * non-DRAFT quotation). Documented here so a test can assert
 * the route's `if (data.X !== undefined) update.X` pattern
 * covers each entry.
 */
export const SENT_LOCKED_FIELDS: ReadonlyArray<keyof QuotationPatchBody> = [
  'title',
  'notes',
  'validUntil',
  'taxRate',
  'currency',
] as const;

/**
 * Fields that are NOT in the SENT lock (CRM metadata). The route
 * allows them to change on a non-DRAFT quotation. Mirrors
 * RG-021's invariant.
 */
export const SENT_UNLOCKED_FIELDS: ReadonlyArray<keyof QuotationPatchBody> = [
  'dealId',
  'salesRepId',
  'status',
] as const;

/**
 * Pure helper that builds a `QuotationPatchBody` from a builder-state
 * snapshot, applying the delta-only convention for `salesRepId`.
 *
 * Invariants pinned:
 *   - `salesRepId` is OMITTED (not `null`) when it equals
 *     `originalSalesRepId` — the backend treats `undefined` as
 *     "leave unchanged" and only writes on a real change. This
 *     prevents no-op diffs from polluting the audit log.
 *   - `dealId` is always sent (even when unchanged from
 *     `originalDealId`) — the backend always clears or sets on
 *     receive, and the route coerces `''` to `null`. Sending the
 *     current value is the only way to "persist the link
 *     unchanged"; the route's `if (data.dealId !== undefined)
 *     update.dealId = data.dealId || null` requires the field to
 *     be present.
 *   - `title` / `notes` use `|| undefined` so empty strings don't
 *     overwrite an existing value with a blank one (UX bug from
 *     the original builder).
 *   - `taxRate` is always sent (it's a number; the route reads
 *     `Number(...)` and writes directly).
 *   - `currency` is sent only when changed (delta-only), like
 *     `salesRepId`. The route treats `undefined` as no-op.
 */
export interface BuilderStateForPatch {
  title: string;
  notes: string;
  validUntil: string;
  taxRate: number;
  dealId: string;
  salesRepId: string | null;
  currency: string;
}

export function buildQuotationPatchBody(
  state: BuilderStateForPatch,
  original: { dealId?: string | null; salesRepId?: string | null; currency?: string },
): QuotationPatchBody {
  const body: QuotationPatchBody = {
    title: state.title || undefined,
    notes: state.notes || undefined,
    taxRate: state.taxRate,
    validUntil: state.validUntil || undefined,
    // dealId is always sent (empty string → null on the backend).
    // RG-020: this is the fix for the "link silently dropped"
    // bug — a missing dealId field would let the backend keep the
    // existing FK.
    dealId: state.dealId || null,
  };

  // salesRepId: delta-only. If unchanged, omit so the audit log
  // doesn't churn. If changed, send the new value (or null to
  // clear). RG-021.
  if (state.salesRepId !== (original.salesRepId ?? null)) {
    body.salesRepId = state.salesRepId;
  }

  // currency: same delta-only pattern (Day 19 multi-currency).
  if (state.currency !== original.currency) {
    body.currency = state.currency;
  }

  return body;
}

/**
 * Validates a PATCH body shape before sending to the backend. Returns
 * an array of human-readable error messages; empty array means OK.
 *
 * Used by the frontend builder's save handler as a pre-flight check
 * (so the user sees a clear error before the network roundtrip).
 * The backend ALSO validates (eventually — RG-024) but the
 * client-side check gives faster feedback.
 */
export function validateQuotationPatchBody(body: QuotationPatchBody): string[] {
  const errs: string[] = [];
  if (body.title !== undefined && typeof body.title !== 'string') {
    errs.push('title must be a string');
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    errs.push('notes must be a string');
  }
  if (body.taxRate !== undefined) {
    if (typeof body.taxRate !== 'number' || isNaN(body.taxRate)) {
      errs.push('taxRate must be a finite number');
    } else if (body.taxRate < 0 || body.taxRate > 100) {
      errs.push('taxRate must be in [0, 100]');
    }
  }
  if (body.dealId !== undefined && body.dealId !== null && typeof body.dealId !== 'string') {
    errs.push('dealId must be a string or null');
  }
  if (body.salesRepId !== undefined && body.salesRepId !== null && typeof body.salesRepId !== 'string') {
    errs.push('salesRepId must be a string or null');
  }
  if (body.currency !== undefined) {
    if (typeof body.currency !== 'string') {
      errs.push('currency must be a string');
    } else if (!['RMB', 'HKD', 'MOP'].includes(body.currency)) {
      errs.push(`currency must be one of RMB, HKD, MOP (got ${body.currency})`);
    }
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string') {
      errs.push('status must be a string');
    } else if (!['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED'].includes(body.status)) {
      errs.push(`status invalid: ${body.status}`);
    }
  }
  return errs;
}
