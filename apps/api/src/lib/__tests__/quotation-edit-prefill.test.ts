/**
 * Regression tests for `quotation-edit-prefill.ts` (Day 30, t3).
 *
 * Pinned invariant — RG-019 (P2-list-page-edit, commit `b95abae`):
 *   The list endpoint (GET /api/quotations) deliberately omits
 *   `items[]` — only `_count.items`. The detail endpoint
 *   (GET /api/quotations/:id) includes the full line items.
 *   When the user clicks 編輯 on the list page, the builder would
 *   receive a list-shape quotation and render an empty form
 *   because `q.items` is `undefined`. The fix is to call
 *   `quotationsApi.get(id)` BEFORE opening the builder.
 *
 * These tests pin:
 *   1. `linesFromQuotation(q, ...)` correctly maps a full-shape
 *      Quotation (with items[]) to builder DraftLines — this is
 *      the path the FE builder's `linesFromQuotation` was
 *      duplicating. A future refactor that swaps the FE's inline
 *      copy for the lib's version should not change observable
 *      behaviour.
 *   2. `linesFromQuotation(undefined, ...)` returns `[emptyLine()]`
 *      — the empty-quotation default. This is what the builder
 *      currently sees when the lib-shape `q` is undefined
 *      (e.g. the list endpoint was queried with a stale cache).
 *   3. `assertPrefillReady(q)` throws `QuotationPrefillMissingError`
 *      when `q` is missing `id` or `items` — the route-side guard
 *      that the FE fix relied on. A future "open in edit mode"
 *      feature that forgets to fetch the full row should fail
 *      here, not silently render an empty form.
 */

import { describe, expect, it } from 'bun:test';
import {
  assertPrefillReady,
  linesFromQuotation,
  QuotationPrefillMissingError,
  type DraftLineFromPrefill,
  type PrefillQuotation,
} from '../quotation-edit-prefill';

// ---- helpers ----

const generateKey = (id: string) => `k_${id}`;

const emptyLine = (): DraftLineFromPrefill => ({
  key: 'k_new',
  itemType: 'PRODUCT',
  name: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
  discount: 0,
});

const fixtureQuotation = (overrides: Partial<PrefillQuotation> = {}): PrefillQuotation => ({
  id: 'q_1',
  items: [
    {
      id: 'qi_1',
      itemType: 'PRODUCT',
      productId: 'p_1',
      name: 'ClickShare CX-50',
      description: 'Wireless presentation hub',
      quantity: 2,
      unitPrice: 12000,
      discount: 0,
    },
    {
      id: 'qi_2',
      itemType: 'SERVICE',
      serviceId: 's_1',
      name: 'Senior Engineer Implementation',
      description: '10 days',
      quantity: 10,
      unitPrice: 5000,
      discount: 0,
    },
  ],
  ...overrides,
});

// ============================================================================
// linesFromQuotation — happy path
// ============================================================================

describe('linesFromQuotation (RG-019 happy path)', () => {
  it('maps each item to a DraftLine preserving all snapshot fields', () => {
    const lines = linesFromQuotation(fixtureQuotation(), generateKey, emptyLine);
    expect(lines).toHaveLength(2);

    // Note: when an item HAS an id, the lib uses the raw id as the
    // key (NOT generateKey wrapped). generateKey is only called
    // for items that don't have an id yet (draft lines). This
    // matches the FE builder's existing behaviour: persisted
    // items use the stable DB id; draft items get a unique key.
    expect(lines[0]).toEqual({
      key: 'qi_1',
      itemId: 'qi_1',
      itemType: 'PRODUCT',
      productId: 'p_1',
      serviceId: undefined,
      sku: undefined,
      name: 'ClickShare CX-50',
      description: 'Wireless presentation hub',
      quantity: 2,
      unitPrice: 12000,
      discount: 0,
      manDaySnapshot: undefined,
      lineGp: undefined,
      lineGpPercent: undefined,
    });
    expect(lines[1]).toEqual({
      key: 'qi_2',
      itemId: 'qi_2',
      itemType: 'SERVICE',
      productId: undefined,
      serviceId: 's_1',
      sku: undefined,
      name: 'Senior Engineer Implementation',
      description: '10 days',
      quantity: 10,
      unitPrice: 5000,
      discount: 0,
      manDaySnapshot: undefined,
      lineGp: undefined,
      lineGpPercent: undefined,
    });
  });

  it('uses the raw item.id as the key (NOT generateKey)', () => {
    // Pinning the rule: a persisted item uses its stable DB id
    // as the React key, so reorder / re-render doesn't remount.
    const lines = linesFromQuotation(fixtureQuotation(), generateKey, emptyLine);
    expect(lines[0].key).toBe('qi_1');
    expect(lines[1].key).toBe('qi_2');
  });

  it('coerces quantity / unitPrice / discount to numbers', () => {
    // The wire format returns Decimal as string. The lib coerces.
    // Pinning the conversion here means a future refactor that
    // switches the wire type (e.g. to a plain number) doesn't
    // accidentally introduce a string-in-arithmetic bug.
    const q: PrefillQuotation = {
      id: 'q_2',
      items: [
        {
          id: 'qi_1',
          itemType: 'PRODUCT',
          name: 'X',
          quantity: '3' as unknown as number, // wire form
          unitPrice: '12000' as unknown as number,
          discount: '0' as unknown as number,
        },
      ],
    };
    const lines = linesFromQuotation(q, generateKey, emptyLine);
    expect(lines[0].quantity).toBe(3);
    expect(lines[0].unitPrice).toBe(12000);
    expect(lines[0].discount).toBe(0);
  });

  it('defaults missing discount to 0', () => {
    const q: PrefillQuotation = {
      id: 'q_3',
      items: [
        {
          id: 'qi_1',
          itemType: 'PRODUCT',
          name: 'X',
          quantity: 1,
          unitPrice: 100,
          // discount intentionally absent
        },
      ],
    };
    const lines = linesFromQuotation(q, generateKey, emptyLine);
    expect(lines[0].discount).toBe(0);
  });

  it('preserves manDaySnapshot when present (SERVICE lines)', () => {
    const q: PrefillQuotation = {
      id: 'q_4',
      items: [
        {
          id: 'qi_1',
          itemType: 'SERVICE',
          serviceId: 's_1',
          name: 'Impl',
          quantity: 5,
          unitPrice: 5000,
          manDaySnapshot: {
            lines: [
              { role: 'PM', dayRate: 3000, days: 5, subtotal: 15000 },
            ],
            notes: 'Includes 2-week handover',
          },
        },
      ],
    };
    const lines = linesFromQuotation(q, generateKey, emptyLine);
    expect(lines[0].manDaySnapshot).toEqual({
      lines: [
        { role: 'PM', dayRate: 3000, days: 5, subtotal: 15000 },
      ],
      notes: 'Includes 2-week handover',
    });
  });

  it('preserves lineGp / lineGpPercent when present', () => {
    // Used by the GP% summary on the builder + detail page.
    const q: PrefillQuotation = {
      id: 'q_5',
      items: [
        {
          id: 'qi_1',
          itemType: 'SERVICE',
          serviceId: 's_1',
          name: 'Impl',
          quantity: 1,
          unitPrice: 10000,
          lineGp: 4000,
          lineGpPercent: 40,
        },
      ],
    };
    const lines = linesFromQuotation(q, generateKey, emptyLine);
    expect(lines[0].lineGp).toBe(4000);
    expect(lines[0].lineGpPercent).toBe(40);
  });
});

// ============================================================================
// linesFromQuotation — empty / missing input (RG-019 the actual bug)
// ============================================================================

describe('linesFromQuotation (RG-019 missing items)', () => {
  it('returns [emptyLine()] when q is undefined (the original bug shape)', () => {
    // The list endpoint excludes items[]. If the builder receives
    // an undefined `existing`, this is what it sees. The lib
    // returns [emptyLine()] so the form has a single blank row
    // rather than crashing on .map.
    const lines = linesFromQuotation(undefined, generateKey, emptyLine);
    expect(lines).toHaveLength(1);
    expect(lines[0].key).toBe('k_new');
    expect(lines[0].name).toBe('');
  });

  it('returns [emptyLine()] when q has no items', () => {
    const q: PrefillQuotation = { id: 'q_1' /* no items */ };
    const lines = linesFromQuotation(q, generateKey, emptyLine);
    expect(lines).toHaveLength(1);
  });

  it('returns [emptyLine()] when items is []', () => {
    const q: PrefillQuotation = { id: 'q_1', items: [] };
    const lines = linesFromQuotation(q, generateKey, emptyLine);
    expect(lines).toHaveLength(1);
  });

  it('uses the emptyLine() key (not generateKey) for the empty-line case', () => {
    // Pinning the rule: when items is empty, the lib returns
    // whatever `emptyLine()` provides. The `generateKey` is
    // reserved for items that have no id yet (draft lines). The
    // empty-line key is owned by the caller (the emptyLine
    // function), not by the lib.
    const lines = linesFromQuotation(undefined, () => 'k_unique', emptyLine);
    expect(lines[0].key).toBe('k_new'); // from the emptyLine fixture
  });
});

// ============================================================================
// items with no DB id (not yet saved) — frontend creates a temp key
// ============================================================================

describe('linesFromQuotation (item without id)', () => {
  it('calls generateKey("line") when the item has no id (draft line)', () => {
    // The frontend builder can hold "draft" line items that
    // aren't yet persisted. The lib uses generateKey for those
    // so the React key is stable across re-renders.
    const q: PrefillQuotation = {
      id: 'q_6',
      items: [
        {
          // no id, no productId, no serviceId — a fresh draft line
          itemType: 'PRODUCT',
          name: 'draft line',
          quantity: 1,
          unitPrice: 0,
        },
      ],
    };
    const lines = linesFromQuotation(q, generateKey, emptyLine);
    // The lib calls generateKey('line') for items without an id
    // (the suffix 'line' is hard-coded in the lib so all draft
    // items share a single generation namespace).
    expect(lines[0].key).toBe('k_line');
    expect(lines[0].itemId).toBeUndefined();
  });
});

// ============================================================================
// assertPrefillReady — the route-side guard
// ============================================================================

describe('assertPrefillReady (RG-019 route-side guard)', () => {
  it('passes for a full-shape quotation', () => {
    expect(() => assertPrefillReady(fixtureQuotation())).not.toThrow();
  });

  it('throws QuotationPrefillMissingError when q is undefined', () => {
    expect(() => assertPrefillReady(undefined)).toThrow(
      QuotationPrefillMissingError,
    );
  });

  it('throws when id is missing', () => {
    const q = fixtureQuotation();
    // strip id
    const { id: _ignored, ...rest } = q;
    expect(() => assertPrefillReady(rest as PrefillQuotation)).toThrow(
      QuotationPrefillMissingError,
    );
  });

  it('throws when items is missing entirely', () => {
    const q: PrefillQuotation = { id: 'q_1' /* no items */ };
    expect(() => assertPrefillReady(q)).toThrow(QuotationPrefillMissingError);
  });

  it('accepts an empty items array (zero items, not undefined) — the lib treats "no items" as "items present, count = 0"', () => {
    // The list endpoint returns `{ items: [] }` shape but
    // `quotationId: <id>` is set. The PATCH to add the first
    // item works because the builder creates the line locally.
    // A future PATCH that mutates existing items would still
    // 409 because the route's POST /:id/items handler requires
    // a real array to compute the next position. This assertion
    // documents the lib's distinction: `items: undefined` (the
    // list-shape bug) throws; `items: []` is treated as "valid
    // but empty" and passes.
    const q: PrefillQuotation = { id: 'q_1', items: [] };
    expect(() => assertPrefillReady(q)).not.toThrow();
  });

  it('error message names the missing field for debuggability', () => {
    try {
      assertPrefillReady(undefined);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QuotationPrefillMissingError);
      const e = err as QuotationPrefillMissingError;
      expect(e.message).toContain('quotation');
      expect(e.missing).toContain('quotation');
    }
  });

  it('error message is stable across calls (no Date / no random ids)', () => {
    // The throw should be deterministic for test stability. A
    // future PR that adds `new Date().toISOString()` to the
    // error message would break this and surface the bug.
    // Use two DIFFERENT invalid shapes to force the throw.
    const err1 = catchPrefillMissingError(undefined);
    const err2 = catchPrefillMissingError(undefined);
    expect(err1.message).toBe(err2.message);
  });
});

function catchPrefillMissingError(q: PrefillQuotation | undefined): QuotationPrefillMissingError {
  try {
    assertPrefillReady(q);
  } catch (e) {
    if (e instanceof QuotationPrefillMissingError) return e;
    throw e;
  }
  throw new Error('expected throw');
}
