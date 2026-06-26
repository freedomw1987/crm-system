/**
 * Quotation line-item snapshot rendering (P2-Snapshot-Display).
 *
 * Why this file exists
 * --------------------
 * The QuotationItem row in the DB already snapshots every field the user
 * needs to see the historical quote (`name`, `description`, `sku`,
 * `unitPrice`, `manDaySnapshot`, …). The Prisma FKs `productId` /
 * `serviceId` are wired with `onDelete: SetNull`, so deleting the
 * catalogue record does NOT cascade — it just nulls the FK and the
 * Prisma relation field. The snapshot data is intact.
 *
 * The QuotationBuilder's autocomplete already uses this snapshot (P1-10,
 * commit 3b36451) — but the **read-only** surfaces (Quotation Detail
 * page, Excel export) didn't. So an old quotation whose product or
 * service was renamed / deleted rendered the line item but didn't show:
 *   - the product's description
 *   - the service's SOW / man-day breakdown
 *   - any indicator that the catalogue record was gone
 *
 * This module centralises the rendering + the pure helpers used by:
 *   - QuotationDetailPage (normal mode + print mode)
 *   - any future read-only view that wants to surface snapshot fidelity
 *
 * Precedence everywhere is "snapshot wins, live is fallback":
 *   - name:     item.name (always set, that's the snapshot)
 *   - sku:      item.sku ?? ''
 *   - description: item.description ?? product?.description ?? service?.description ?? null
 *   - manDay:   item.manDaySnapshot ?? []
 *   - deleted:  !item.product  (for PRODUCT)  ||  !item.service  (for SERVICE)
 */

import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import type { QuotationItem } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Live relation shape returned by GET /quotations/:id. The list endpoint
 * doesn't include them — only the detail endpoint — so they're optional
 * on the input type. The detection helpers all null-check before use.
 */
export interface QuotationItemWithRelations extends QuotationItem {
  product?: { id: string; name: string; sku: string; description?: string | null } | null;
  service?: {
    id: string;
    name: string;
    description?: string | null;
    // manDayLines is NOT snapshotted here — the snapshot lives on
    // `item.manDaySnapshot`. We only use service for the live-fallback
    // description when the snapshot is missing.
  } | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable, no React)
// ---------------------------------------------------------------------------

/**
 * Was the underlying catalogue record (Product or Service) deleted
 * after this Quotation line was created?
 *
 * Logic: with `onDelete: SetNull` on the QuotationItem FK, a delete
 * nulls BOTH the FK column AND the Prisma relation field. So:
 *   - PRODUCT line with `item.product === null` → catalogue record was deleted
 *   - SERVICE line with `item.service === null` → catalogue record was deleted
 *   - The snapshot fields (`name`, `description`, `manDaySnapshot`)
 *     still hold the historical value, so the line is not "lost" —
 *     just visually flagged so the reader knows it's frozen.
 */
export function isLineItemDeleted(
  item: QuotationItemWithRelations,
): boolean {
  if (item.itemType === 'PRODUCT') return item.product == null;
  return item.service == null;
}

/**
 * Resolve the description to render for a line item.
 * Order: snapshot > live catalogue > null.
 * Returns null if no description is available at any layer.
 */
export function resolveLineItemDescription(
  item: QuotationItemWithRelations,
): string | null {
  if (item.description) return item.description;
  if (item.product?.description) return item.product.description;
  if (item.service?.description) return item.service.description;
  return null;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Meta block rendered under a line-item's name in the read-only tables
 * on the Quotation Detail page. Shows:
 *   - "SKU: xxx" (if SKU is set, in muted text)
 *   - description (snapshot, muted text, optional)
 *   - SERVICE SOW breakdown (collapsible <details>)
 *   - "(已刪除)" badge when the catalogue record was deleted
 *
 * Used by:
 *   - QuotationDetailPage normal-mode table
 *   - QuotationDetailPage print-mode table (same markup, slightly tighter spacing)
 */
export function LineItemSnapshotMeta({
  item,
  print = false,
}: {
  item: QuotationItemWithRelations;
  /** Tighter spacing for print layout. */
  print?: boolean;
}) {
  const deleted = isLineItemDeleted(item);
  const description = resolveLineItemDescription(item);
  const sow = item.manDaySnapshot ?? [];
  const showSow = item.itemType === 'SERVICE' && sow.length > 0;
  const descClass = print ? 'text-xs text-gray-600 mt-0.5' : 'text-xs text-muted-foreground mt-0.5';
  const labelClass = print
    ? 'inline-block text-[10px] uppercase tracking-wide text-gray-500 border border-gray-400 px-1 rounded mr-1 align-middle'
    : 'inline-block text-[10px] uppercase tracking-wide border border-destructive/40 text-destructive px-1.5 py-0.5 rounded mr-1.5 align-middle';

  return (
    <div className="space-y-1">
      {deleted && (
        <div>
          <span className={labelClass} data-testid={`line-deleted-${item.id ?? item.name}`}>
            (已刪除)
          </span>
          {print ? (
            <span className="text-[10px] text-gray-500 italic">
              原紀錄已刪除,以下為 snapshot 資料
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground italic">
              原紀錄已刪除,以下為 snapshot 資料
            </span>
          )}
        </div>
      )}
      {item.itemType === 'SERVICE' && !deleted && (
        // Lightweight type indicator — helps the reader scan a long quote
        <Badge variant="outline" className="text-[10px] py-0">Service</Badge>
      )}
      {description && (
        <p className={descClass + ' whitespace-pre-wrap'}>
          {description}
        </p>
      )}
      {showSow && (
        <details className={print ? 'text-xs' : 'text-xs'} data-testid={`line-sow-${item.id ?? item.name}`}>
          <summary className={print ? 'cursor-pointer text-gray-700 hover:text-black' : 'cursor-pointer text-muted-foreground hover:text-foreground'}>
            SOW · {sow.length} 個 role breakdown
          </summary>
          <div className={print ? 'mt-1 space-y-0.5 pl-3 border-l-2 border-gray-400' : 'mt-1.5 space-y-0.5 pl-3 border-l-2 border-primary/30'}>
            {sow.map((m, i) => (
              <div
                key={i}
                className={print ? 'flex justify-between text-gray-700' : 'flex justify-between text-muted-foreground'}
              >
                <span>
                  {m.role} · {m.days}d × {formatCurrency(m.dayRate)}
                </span>
                <span className="tabular-nums">{formatCurrency(m.subtotal)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
