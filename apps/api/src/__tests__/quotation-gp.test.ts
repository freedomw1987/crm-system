/**
 * US-A3 regression tests — Quotation GP% formula (2026-06-08).
 *
 * Background: gpOf() and costPerManDayFromSnapshot() originally lived
 * as private functions inside `apps/api/src/routes/quotation.ts`. They
 * were extracted into `apps/api/src/lib/quotation-gp.ts` on 2026-06-08
 * (RG-CHAT-002 follow-up) so they can be unit-tested in isolation,
 * without spinning up the Elysia app, the Prisma client, or the DB.
 * These tests pin the formulas so a future refactor can't silently
 * change the numbers on existing quotations.
 *
 * The formulas in turn drive the totals shown on the Quotation
 * detail page and the Excel export (US-A5). Wrong GP% is a deal-killer
 * — sales would lose trust in the system.
 */
import { describe, it, expect } from 'bun:test';
import { gpOf, costPerManDayFromSnapshot } from '../lib/quotation-gp';

describe('gpOf (US-A3)', () => {
  describe('PRODUCT lines', () => {
    it('returns lineGp = lineTotal and lineGpPercent = 100 (cost is 0)', () => {
      // Off-the-shelf product: there's no man-day cost, so GP% is
      // always 100%. The costSnapshot argument is ignored for
      // PRODUCT lines.
      const r = gpOf('PRODUCT', 12_500, 0);
      expect(r.lineGp).toBe(12_500);
      expect(r.lineGpPercent).toBe(100);
    });

    it('ignores a non-zero costSnapshot for PRODUCT lines (RG-2026-06-08-A3-A)', () => {
      // Defensive: if the caller mistakenly passes a costSnapshot
      // for a PRODUCT line, the formula must still return 100% GP.
      // This invariant matters because re-imports of historical data
      // sometimes carry cost values from the service-snapshot field.
      const r = gpOf('PRODUCT', 1_000, 999_999);
      expect(r.lineGp).toBe(1_000);
      expect(r.lineGpPercent).toBe(100);
    });
  });

  describe('SERVICE lines (the worked example from the docstring)', () => {
    it('matches the spec: ¥1000/day × 5 days, cost ¥600/day → 40% GP', () => {
      //   lineTotal = 1000 * 5 = 5000
      //   costSnapshot = 600 * 5 = 3000
      //   lineGp = 5000 - 3000 = 2000
      //   lineGpPercent = 2000 / 5000 = 40%
      const r = gpOf('SERVICE', 5_000, 3_000);
      expect(r.lineGp).toBe(2_000);
      expect(r.lineGpPercent).toBe(40);
    });

    it('returns 100% GP when costSnapshot = 0 (free service line)', () => {
      // Edge case: a goodwill / pro-bono service line.
      const r = gpOf('SERVICE', 10_000, 0);
      expect(r.lineGp).toBe(10_000);
      expect(r.lineGpPercent).toBe(100);
    });

    it('returns 0% GP when costSnapshot = lineTotal (break-even)', () => {
      const r = gpOf('SERVICE', 8_000, 8_000);
      expect(r.lineGp).toBe(0);
      expect(r.lineGpPercent).toBe(0);
    });

    it('returns negative lineGp and <0% when cost > lineTotal (loss-making)', () => {
      // 25% loss. The route renders this in red on the quotation
      // detail page; the formula MUST allow negatives.
      const r = gpOf('SERVICE', 4_000, 5_000);
      expect(r.lineGp).toBe(-1_000);
      expect(r.lineGpPercent).toBe(-25);
    });

    it('returns 0% (not NaN) when lineTotal = 0', () => {
      // NaN would propagate to the UI as "NaN%". The formula's
      // `lineTotal > 0 ? ... : 0` guard exists for exactly this case.
      const r = gpOf('SERVICE', 0, 100);
      expect(r.lineGp).toBe(-100);
      expect(r.lineGpPercent).toBe(0);
      expect(Number.isFinite(r.lineGpPercent)).toBe(true);
    });
  });

  describe('unknown / future item types (RG-2026-06-08-A3-B)', () => {
    it('treats unknown item types as SERVICE (default branch)', () => {
      // The schema enum is currently PRODUCT | SERVICE. If we add
      // SUBSCRIPTION or LICENSE later, the formula will fall through
      // to the SERVICE branch by default. This test pins that
      // behaviour so a future refactor doesn't accidentally treat
      // unknown types as PRODUCT (which would force GP% to 100 and
      // hide real cost data).
      const r = gpOf('SUBSCRIPTION', 5_000, 3_000);
      expect(r.lineGp).toBe(2_000);
      expect(r.lineGpPercent).toBe(40);
    });
  });
});

describe('costPerManDayFromSnapshot (US-A3)', () => {
  it('returns 0 for null / undefined / non-object input', () => {
    expect(costPerManDayFromSnapshot(null)).toBe(0);
    expect(costPerManDayFromSnapshot(undefined)).toBe(0);
    expect(costPerManDayFromSnapshot('foo')).toBe(0);
    expect(costPerManDayFromSnapshot(42)).toBe(0);
  });

  it('returns 0 when the snapshot has no `lines` array', () => {
    expect(costPerManDayFromSnapshot({})).toBe(0);
    expect(costPerManDayFromSnapshot({ lines: null })).toBe(0);
    expect(costPerManDayFromSnapshot({ lines: 'oops' })).toBe(0);
  });

  it('returns 0 for an empty `lines` array', () => {
    expect(costPerManDayFromSnapshot({ lines: [] })).toBe(0);
  });

  it('skips malformed line entries without throwing', () => {
    // Mixed valid + garbage: should not blow up; should sum the
    // valid ones. (The caller multiplies this by quantity to get
    // the line's costSnapshot.)
    const r = costPerManDayFromSnapshot({
      lines: [
        { days: 3, costRate: 100 }, // valid: 300
        null,                       // skipped
        { /* missing fields */ },   // skipped (days = 0, costRate = 0)
        { days: 2, costRate: 200 }, // valid: 400
      ],
    });
    // totalCost = 300 + 400 = 700, totalDays = 3 + 2 = 5
    // weighted avg = 700 / 5 = 140
    expect(r).toBe(140);
  });

  it('returns the weighted-average cost per man-day across roles', () => {
    // 3-day Senior @ ¥600 + 2-day Junior @ ¥300
    //   total cost = 3*600 + 2*300 = 2400
    //   total days = 5
    //   weighted avg = 2400 / 5 = 480
    const r = costPerManDayFromSnapshot({
      lines: [
        { days: 3, costRate: 600 },
        { days: 2, costRate: 300 },
      ],
    });
    expect(r).toBe(480);
  });

  it('returns 0 when total days is 0 (all-zero snapshot)', () => {
    const r = costPerManDayFromSnapshot({
      lines: [
        { days: 0, costRate: 999 },
        { days: 0, costRate: 999 },
      ],
    });
    expect(r).toBe(0);
  });
});
