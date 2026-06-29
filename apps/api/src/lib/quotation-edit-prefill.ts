/**
 * Helpers for the "edit existing Quotation" flow.
 *
 * Pinned by RG-019 (P2-list-page-edit):
 *   The Quotation list endpoint (GET /api/quotations) deliberately
 *   omits `items[]` for performance — only `_count.items`. The detail
 *   endpoint (GET /api/quotations/:id) includes the full line items.
 *   When the user clicks 編輯 on the list page, the builder would
 *   receive a list-shape quotation and render an empty form because
 *   `q.items` is `undefined`. The fix is to call `quotationsApi.get(id)`
 *   BEFORE opening the builder.
 *
 * This module exposes the helper that the builder uses, plus an
 * `assertPrefillReady(q)` guard the route could call if the API
 * ever starts accepting PATCH /quotations/:id with line items
 * (per RG-024).
 *
 * Why this lives in a lib file (not inline in the frontend
 * builder): the shape is the backend's contract too. The backend's
 * PATCH handler should eventually call `assertPrefillReady` before
 * trusting the body — if the request came in via a list-edit UI
 * that forgot the fetch, the backend can 400 instead of silently
 * no-op'ing the items.
 *
 * Note on types: this module is structurally typed (only the
 * fields the helper actually reads) so it can live in `apps/api`
 * without depending on `apps/web`. The frontend builder's
 * `linesFromQuotation` function has the same shape — it should
 * eventually be replaced with a re-export from this module.
 */

export interface PrefillLineItem {
  /** DB id; null when the item is brand new (not yet saved). */
  id?: string | null;
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string | null;
  serviceId?: string | null;
  sku?: string | null;
  name: string;
  description?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  discount?: number | string | null;
  manDaySnapshot?: unknown;
  lineGp?: number | string | null;
  lineGpPercent?: number | string | null;
}

export interface PrefillQuotation {
  id: string;
  items?: PrefillLineItem[];
}

/**
 * The shape the builder's `DraftLine` has. We define it here
 * structurally so the lib doesn't depend on apps/web/src.
 */
export interface DraftLineFromPrefill {
  key: string;
  itemId?: string;
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string;
  serviceId?: string;
  sku?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  manDaySnapshot?: unknown;
  lineGp?: number;
  lineGpPercent?: number;
}

/**
 * Build the builder's DraftLines from a Quotation. Pure function —
 * no React, no Prisma, no fetch. Trivially testable.
 *
 * Mirrors the existing `linesFromQuotation` in
 * `apps/web/src/components/quotation-builder.tsx` so the refactor
 * to "use this lib everywhere" is a 1-line change on the frontend.
 */
export function linesFromQuotation(
  q: PrefillQuotation | undefined,
  /** A function that returns a stable per-line key when the item has no DB id. */
  generateKey: (id: string) => string,
  /** A function that produces an empty DraftLine. */
  emptyLine: () => DraftLineFromPrefill,
): DraftLineFromPrefill[] {
  if (!q?.items?.length) return [emptyLine()];
  return q.items.map((it) => ({
    key: it.id ?? generateKey('line'),
    itemId: it.id ?? undefined,
    itemType: it.itemType,
    productId: it.productId ?? undefined,
    serviceId: it.serviceId ?? undefined,
    sku: it.sku ?? undefined,
    name: it.name,
    description: it.description ?? undefined,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unitPrice),
    discount: Number(it.discount ?? 0),
    manDaySnapshot: it.manDaySnapshot ?? undefined,
    lineGp: it.lineGp != null ? Number(it.lineGp) : undefined,
    lineGpPercent: it.lineGpPercent != null ? Number(it.lineGpPercent) : undefined,
  }));
}

/**
 * Throws an Error if the given quotation is missing the data the
 * builder needs to render existing line items.
 *
 * Use case: a list-edit UI that forgot to fetch the full row
 * (per RG-019) would get caught here at the route level. Currently
 * the route handlers don't call this — it's defensive for a future
 * refactor where the route tries to render "edit" using the
 * list-shape payload.
 */
export class QuotationPrefillMissingError extends Error {
  readonly quoteNumber?: string;
  readonly missing: ReadonlyArray<string>;
  constructor(opts: { quoteNumber?: string; missing: string[] }) {
    super(
      `Quotation${opts.quoteNumber ? ` ${opts.quoteNumber}` : ''} is missing ` +
      `pre-fill data: ${opts.missing.join(', ')}. ` +
      `The list endpoint excludes items[] — callers must fetch the ` +
      `full row via GET /quotations/:id before opening the edit form.`
    );
    this.name = 'QuotationPrefillMissingError';
    this.quoteNumber = opts.quoteNumber;
    this.missing = Object.freeze(opts.missing);
  }
}

export function assertPrefillReady(
  q: PrefillQuotation | undefined,
): asserts q is PrefillQuotation & { items: PrefillLineItem[] } {
  const missing: string[] = [];
  if (!q) missing.push('quotation');
  else {
    if (!q.id) missing.push('id');
    if (!q.items) missing.push('items[]');
  }
  if (missing.length > 0) {
    throw new QuotationPrefillMissingError({
      quoteNumber: undefined,
      missing,
    });
  }
}
