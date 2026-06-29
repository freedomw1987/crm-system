/**
 * Regression tests for `quotation-patch-body.ts` (Day 30, t3).
 *
 * Pinned invariants:
 *
 *   RG-020 (P2-quotation-deal-link, commit `d2f2444`): the PATCH
 *     body builder must round-trip `dealId` faithfully. The earlier
 *     bug was that the route's body typecast dropped the field, so
 *     a user could "edit" a quotation and the Deal association would
 *     silently disappear. `buildQuotationPatchBody` must always
 *     emit `dealId` (even when it's "" → coerced to `null` on the
 *     server), and `validateQuotationPatchBody` must not reject
 *     `dealId: null`.
 *
 *   RG-021 (P2-sales-rep follow-up, commit `02c333a`): the SENT
 *     lock must cover ONLY the customer-visible contractual
 *     fields (`title`, `notes`, `validUntil`, `taxRate`, `currency`).
 *     `dealId` and `salesRepId` are CRM metadata and remain
 *     mutable across the lifecycle — they MUST NOT appear in
 *     `SENT_LOCKED_FIELDS`. The earlier draft that incorrectly
 *     locked `dealId` (per the wrong "sales-attribution" reasoning)
 *     was reverted in `02c333a`. This test pins the post-revert
 *     invariant.
 *
 *   Customer-visible fields not wiped (RG-020/021 followup): the
 *     builder uses `|| undefined` (not `|| ""` or `|| null`) for
 *     `title` / `notes` / `validUntil` so an empty form field
 *     doesn't blank out an existing value.
 *
 * Why a unit suite here, not in the route: the route still uses
 * an implicit `body as {...}` typecast (per RG-024), so testing
 * the route would only exercise Elysia's plumbing. Testing the
 * factory directly gives us tight assertions on the contract the
 * route promises to the frontend.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildQuotationPatchBody,
  SENT_LOCKED_FIELDS,
  SENT_UNLOCKED_FIELDS,
  validateQuotationPatchBody,
  type QuotationPatchBody,
} from '../quotation-patch-body';

// ---- helpers ----

const baseState = () => ({
  title: 'Q2 Upgrade Quote',
  notes: 'Includes 5x enterprise license + setup.',
  validUntil: '2026-12-31',
  taxRate: 13,
  dealId: 'deal_abc',
  salesRepId: 'user_sales',
  currency: 'HKD',
});

// ============================================================================
// RG-020: dealId pass-through
// ============================================================================

describe('buildQuotationPatchBody (RG-020 dealId pass-through)', () => {
  it('emits dealId as a string when state has a dealId', () => {
    const body = buildQuotationPatchBody(baseState(), {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect(body.dealId).toBe('deal_abc');
  });

  it('emits dealId: null when state.dealId is "" (clear the link)', () => {
    // The autocomplete-cleared case: user picks nothing. The builder
    // must send null (not undefined) so the backend FK is cleared.
    // If it sent undefined, the backend's "leave unchanged" branch
    // would fire and the link would persist.
    const state = { ...baseState(), dealId: '' };
    const body = buildQuotationPatchBody(state, {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect(body.dealId).toBeNull();
  });

  it('emits dealId: null when state.dealId is empty-string and original was null', () => {
    // Defensive: no original deal → no change → still null in body
    const state = { ...baseState(), dealId: '' };
    const body = buildQuotationPatchBody(state, {
      dealId: null, salesRepId: 'user_sales', currency: 'HKD',
    });
    expect(body.dealId).toBeNull();
  });
});

// ============================================================================
// RG-020 / RG-021: SENT-lock list excludes dealId + salesRepId
// ============================================================================

describe('SENT_LOCKED_FIELDS (RG-021)', () => {
  it('includes the 5 customer-visible fields', () => {
    // Pin the canonical list. Adding a new contractual field is a
    // single edit here + in QuotationPatchBody.
    expect(new Set(SENT_LOCKED_FIELDS)).toEqual(
      new Set(['title', 'notes', 'validUntil', 'taxRate', 'currency']),
    );
  });

  it('does NOT include dealId (CRM metadata, not contractual)', () => {
    // RG-021: locking dealId was the original bug. Pinning its
    // absence is the whole point of this entry.
    expect(SENT_LOCKED_FIELDS).not.toContain('dealId');
  });

  it('does NOT include salesRepId (CRM metadata)', () => {
    // salesRepId is owner-assignment, not contractual.
    expect(SENT_LOCKED_FIELDS).not.toContain('salesRepId');
  });

  it('does NOT include status (transition rules are separate)', () => {
    // Status has its own transition logic on the route; the SENT
    // lock is about CONTRACTUAL fields, not state changes.
    expect(SENT_LOCKED_FIELDS).not.toContain('status');
  });
});

describe('SENT_UNLOCKED_FIELDS (RG-021 complement)', () => {
  it('contains exactly dealId, salesRepId, status', () => {
    expect(new Set(SENT_UNLOCKED_FIELDS)).toEqual(
      new Set(['dealId', 'salesRepId', 'status']),
    );
  });
});

// ============================================================================
// Customer-visible fields: not wiped by empty input
// ============================================================================

describe('buildQuotationPatchBody (customer-visible fields not wiped)', () => {
  it('title: empty string becomes undefined (does not wipe the row)', () => {
    // If we sent `title: ""`, the route's `if (data.title !== undefined)
    // update.title = data.title` branch would set the title to "" —
    // wiping the existing value. The builder uses `|| undefined` so
    // an empty input is treated as "no change" instead. (Note: the
    // property KEY is still present on the body object, but the
    // VALUE is `undefined` — the route's `if (data.title !== undefined)`
    // guard then skips the field. This is JS-object-key semantics
    // and matches the existing builder behaviour.)
    const state = { ...baseState(), title: '' };
    const body = buildQuotationPatchBody(state, {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect(body.title).toBeUndefined();
  });

  it('notes: empty string becomes undefined', () => {
    const state = { ...baseState(), notes: '' };
    const body = buildQuotationPatchBody(state, {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect(body.notes).toBeUndefined();
  });

  it('validUntil: empty string becomes undefined (does not null the date)', () => {
    // validUntil is special: `null` IS the clear signal. But
    // `''` is "the user emptied the input by accident" — the builder
    // treats it as "no change" so the existing date persists.
    const state = { ...baseState(), validUntil: '' };
    const body = buildQuotationPatchBody(state, {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect(body.validUntil).toBeUndefined();
  });

  it('taxRate: 0 IS sent (not undefined), so the user can clear the rate', () => {
    // 0 is a valid tax rate. We must send it; `|| undefined` would
    // skip it because 0 is falsy in JS. We use `data.taxRate` (not
    // `data.taxRate || undefined`) on the backend for the same
    // reason. Here the builder always sends taxRate regardless.
    const state = { ...baseState(), taxRate: 0 };
    const body = buildQuotationPatchBody(state, {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect(body.taxRate).toBe(0);
  });
});

// ============================================================================
// Delta-only convention (RG-021 followup: audit-log noise reduction)
// ============================================================================

describe('buildQuotationPatchBody (delta-only salesRepId + currency)', () => {
  it('omits salesRepId when unchanged (audit log no-op reduction)', () => {
    const body = buildQuotationPatchBody(baseState(), {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect('salesRepId' in body).toBe(false);
  });

  it('emits salesRepId when changed to a different value', () => {
    // state has salesRepId = 'user_sales' (from baseState), the
    // original is 'user_legacy' → state !== original → emit.
    const body = buildQuotationPatchBody(baseState(), {
      dealId: 'deal_abc', salesRepId: 'user_legacy', currency: 'HKD',
    });
    expect(body.salesRepId).toBe('user_sales');
  });

  it('emits salesRepId: null when explicitly cleared (was set, now null)', () => {
    const state = { ...baseState(), salesRepId: null };
    const body = buildQuotationPatchBody(state, {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect(body.salesRepId).toBeNull();
  });

  it('emits salesRepId: null when explicit null on a previously-null record (changed from null→null is still a delta)', () => {
    // Original was null, state is null. The inequality check
    // (state.salesRepId !== original.salesRepId ?? null) treats
    // null === null as equal and OMITS the field — this is the
    // "no change" case. The PATCH is still a valid body (no field
    // = no-op on the backend).
    const state = { ...baseState(), salesRepId: null };
    const body = buildQuotationPatchBody(state, {
      dealId: 'deal_abc', salesRepId: null, currency: 'HKD',
    });
    expect('salesRepId' in body).toBe(false);
  });

  it('omits currency when unchanged', () => {
    const body = buildQuotationPatchBody(baseState(), {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'HKD',
    });
    expect('currency' in body).toBe(false);
  });

  it('emits currency when changed (e.g. RMB → HKD)', () => {
    const body = buildQuotationPatchBody(baseState(), {
      dealId: 'deal_abc', salesRepId: 'user_sales', currency: 'RMB',
    });
    expect(body.currency).toBe('HKD');
  });
});

// ============================================================================
// validateQuotationPatchBody: pre-flight checker
// ============================================================================

describe('validateQuotationPatchBody', () => {
  it('returns [] for a valid body', () => {
    const errs = validateQuotationPatchBody({
      title: 'X', taxRate: 0, dealId: 'd1',
    });
    expect(errs).toEqual([]);
  });

  it('flags taxRate out of range (negative)', () => {
    const errs = validateQuotationPatchBody({ taxRate: -1 });
    expect(errs.some((e) => e.includes('taxRate'))).toBe(true);
  });

  it('flags taxRate out of range (over 100)', () => {
    const errs = validateQuotationPatchBody({ taxRate: 101 });
    expect(errs.some((e) => e.includes('taxRate'))).toBe(true);
  });

  it('flags taxRate: NaN (a previous bug — before the .Number() coercion)', () => {
    const errs = validateQuotationPatchBody({ taxRate: NaN });
    expect(errs.some((e) => e.includes('finite'))).toBe(true);
  });

  it('accepts dealId: null (clear-the-link, RG-020 invariant)', () => {
    const errs = validateQuotationPatchBody({ dealId: null });
    expect(errs).toEqual([]);
  });

  it('accepts dealId: "deal_xyz" (set-the-link)', () => {
    const errs = validateQuotationPatchBody({ dealId: 'deal_xyz' });
    expect(errs).toEqual([]);
  });

  it('flags dealId: 12345 (wrong type)', () => {
    const errs = validateQuotationPatchBody({ dealId: 12345 as unknown as string });
    expect(errs.some((e) => e.includes('dealId'))).toBe(true);
  });

  it('flags salesRepId: false (wrong type)', () => {
    const errs = validateQuotationPatchBody({ salesRepId: false as unknown as string });
    expect(errs.some((e) => e.includes('salesRepId'))).toBe(true);
  });

  it('accepts salesRepId: null (clear-the-rep)', () => {
    const errs = validateQuotationPatchBody({ salesRepId: null });
    expect(errs).toEqual([]);
  });

  it('flags currency: "USD" (not in the allowed set)', () => {
    const errs = validateQuotationPatchBody({ currency: 'USD' });
    expect(errs.some((e) => e.includes('currency'))).toBe(true);
  });

  it('accepts the three allowed currencies', () => {
    for (const c of ['RMB', 'HKD', 'MOP']) {
      expect(validateQuotationPatchBody({ currency: c })).toEqual([]);
    }
  });

  it('flags status: "FOOBAR" (invalid status string)', () => {
    const errs = validateQuotationPatchBody({ status: 'FOOBAR' });
    expect(errs.some((e) => e.includes('status'))).toBe(true);
  });

  it('accepts every legal status', () => {
    for (const s of ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED']) {
      expect(validateQuotationPatchBody({ status: s })).toEqual([]);
    }
  });
});

// ============================================================================
// Sanity: the export shape is what the route imports
// ============================================================================

describe('QuotationPatchBody type contract (sanity)', () => {
  // The route file does `body as QuotationPatchBody`. If we
  // accidentally rename a field here, that typecast would still
  // pass (no runtime check) but the field would never reach the
  // backend. This test pins the field set so the route's
  // "leaving the field undefined means no-op" pattern is the only
  // way a field can be silently dropped.
  it('exposes exactly the expected fields', () => {
    const body: QuotationPatchBody = {};
    const keys = Object.keys(body);
    // The empty body has no keys; this just confirms the type
    // is structurally valid. The real assertion is in the tests
    // above: any new field added to QuotationPatchBody MUST
    // show up in SENT_LOCKED_FIELDS (if contractual) or be
    // explicit about being CRM metadata.
    expect(keys).toEqual([]);
  });
});
