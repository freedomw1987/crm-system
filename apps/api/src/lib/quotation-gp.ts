/**
 * Pure GP% (gross profit) helpers for Quotation line items.
 *
 * Extracted from `routes/quotation.ts` on 2026-06-08 (US-A3, RG-CHAT-002
 * follow-up) so the formulas can be unit-tested without spinning up
 * the Elysia app, the Prisma client, or the DB connection. The route
 * file imports the same functions; behaviour is bit-for-bit identical.
 *
 * Formula reference (PRD US-A3, also documented at the original
 * function in `routes/quotation.ts:29-55`):
 *
 *   PRODUCT:
 *     costSnapshot is always 0 (no man-day cost for off-the-shelf items).
 *     lineGp = lineTotal
 *     lineGpPercent = 100
 *
 *   SERVICE:
 *     costSnapshot = sum(manDayLine.costRate * days), captured at
 *       line creation time. The "quantity" of a SERVICE line is the
 *       man-day count, so costSnapshot already represents the total
 *       cost for the line (no multiplication needed).
 *     lineGp = lineTotal - costSnapshot
 *     lineGpPercent = lineTotal > 0 ? (lineGp / lineTotal) * 100 : 0
 *
 * Worked example from the route file:
 *   Senior Engineer (¥1000 sell, ¥600 cost) × 5 days
 *     lineTotal = 1000 * 5 = 5000
 *     costSnapshot = 600 * 5 = 3000
 *     lineGp = 5000 - 3000 = 2000
 *     lineGpPercent = 2000 / 5000 = 40%
 */

export interface GpResult {
  lineGp: number;
  lineGpPercent: number;
}

export function gpOf(
  itemType: string,
  lineTotal: number,
  costSnapshot: number,
): GpResult {
  if (itemType === 'PRODUCT') {
    return { lineGp: lineTotal, lineGpPercent: 100 };
  }
  const gp = lineTotal - costSnapshot;
  const percent = lineTotal > 0 ? (gp / lineTotal) * 100 : 0;
  return { lineGp: gp, lineGpPercent: percent };
}

/**
 * Extract the per-line cost (per *man-day unit*) from a manDaySnapshot.
 * The snapshot is the JSON object stored on QuotationItem.manDaySnapshot
 * that captures the SOW breakdown at quotation-creation time:
 *   { lines: [{ role, dayRate, days, costRate, subtotal }], notes }
 *
 * Returns cost per man-day unit (i.e. weighted-average cost across the
 * snapshot's lines). The line's "quantity" field in the quotation is
 * then the number of man-days, so multiplying costPerManDay by quantity
 * gives the line's costSnapshot.
 */
export function costPerManDayFromSnapshot(snap: unknown): number {
  if (!snap || typeof snap !== 'object') return 0;
  const lines = (snap as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length === 0) return 0;
  let totalCost = 0;
  let totalDays = 0;
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    const days = Number((l as { days?: number }).days ?? 0);
    const costRate = Number((l as { costRate?: number }).costRate ?? 0);
    totalCost += costRate * days;
    totalDays += days;
  }
  if (totalDays <= 0) return 0;
  return totalCost / totalDays;
}
