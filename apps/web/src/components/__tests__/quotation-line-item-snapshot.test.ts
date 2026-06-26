/**
 * Tests for the read-only Quotation line-item snapshot rendering
 * (P2-Snapshot-Display).
 *
 * Why this file exists
 * --------------------
 * QuotationItem already snapshots `name`, `description`, `sku`,
 * `unitPrice`, `manDaySnapshot`, etc. The QuotationBuilder's autocomplete
 * uses these (P1-10). But the read-only surfaces — the QuotationDetailPage
 * line-items table (normal + print modes) and the Excel export — did NOT.
 * An old quotation whose Product or Service was renamed or deleted
 * rendered the line item without:
 *   - description
 *   - SOW / man-day breakdown (services)
 *   - any "(已刪除)" indicator
 *
 * These pure-function tests pin the contract so a future refactor can't
 * regress the "snapshot wins, live is fallback" precedence on the
 * read-only views.
 *
 * Pattern mirrors `quotation-builder-snapshot.test.ts` (P1-10): tiny
 * helpers, no React, no mocks — just input shape → expected output.
 */

import { describe, it, expect } from 'vitest';
import {
  isLineItemDeleted,
  resolveLineItemDescription,
  type QuotationItemWithRelations,
} from '../quotation-line-item-snapshot';

const baseItem: QuotationItemWithRelations = {
  id: 'qi-1',
  itemType: 'PRODUCT',
  productId: 'prod-1',
  name: 'Enterprise License',
  sku: 'LIC-001',
  description: null,
  quantity: 1,
  unitPrice: 10000,
  discount: 0,
  lineTotal: 10000,
  costSnapshot: 0,
  lineGp: 10000,
  lineGpPercent: 100,
  product: { id: 'prod-1', name: 'Enterprise License', sku: 'LIC-001' },
  service: null,
  manDaySnapshot: null,
};

describe('isLineItemDeleted (snapshot vs live)', () => {
  it('PRODUCT line: true when the live product is null (catalogue record deleted)', () => {
    expect(isLineItemDeleted({ ...baseItem, product: null })).toBe(true);
    expect(isLineItemDeleted({ ...baseItem, product: undefined })).toBe(true);
  });

  it('PRODUCT line: false when the live product is still present (even if renamed)', () => {
    // Renamed is NOT deletion — the line is still pointing at a live record.
    // The snapshot will still win for display (rendering layer), but the
    // "已刪除" badge is for actual deletion only.
    expect(
      isLineItemDeleted({
        ...baseItem,
        product: { id: 'prod-1', name: 'Enterprise License v2', sku: 'LIC-001' },
      }),
    ).toBe(false);
  });

  it('SERVICE line: true when the live service is null (catalogue record deleted)', () => {
    const svcBase: QuotationItemWithRelations = {
      ...baseItem,
      itemType: 'SERVICE',
      productId: null,
      serviceId: 'svc-1',
      product: null,
      service: null,
      manDaySnapshot: [
        { role: 'PM', dayRate: 3000, days: 5, subtotal: 15000 },
      ],
    };
    expect(isLineItemDeleted(svcBase)).toBe(true);
  });

  it('SERVICE line: false when the live service is still present', () => {
    expect(
      isLineItemDeleted({
        ...baseItem,
        itemType: 'SERVICE',
        productId: null,
        serviceId: 'svc-1',
        product: null,
        service: { id: 'svc-1', name: 'Implementation' },
        manDaySnapshot: [
          { role: 'PM', dayRate: 3000, days: 5, subtotal: 15000 },
        ],
      }),
    ).toBe(false);
  });
});

describe('resolveLineItemDescription (snapshot wins, live is fallback)', () => {
  it('prefers item.description snapshot over live catalogue', () => {
    // Customer was quoted against this exact description; even if the
    // product was renamed or its description updated, we keep the snapshot.
    expect(
      resolveLineItemDescription({
        ...baseItem,
        description: 'Includes 1-year support (snapshot)',
        product: { id: 'prod-1', name: 'X', sku: 'LIC-001', description: 'Live description' },
      }),
    ).toBe('Includes 1-year support (snapshot)');
  });

  it('falls back to live product description when snapshot is missing', () => {
    // New line that has no description snapshot yet (rare but possible
    // after a partial migration). Live catalogue is the fallback.
    expect(
      resolveLineItemDescription({
        ...baseItem,
        description: null,
        product: { id: 'prod-1', name: 'X', sku: 'LIC-001', description: 'Live description' },
      }),
    ).toBe('Live description');
  });

  it('falls back to live service description for SERVICE items', () => {
    expect(
      resolveLineItemDescription({
        ...baseItem,
        itemType: 'SERVICE',
        productId: null,
        serviceId: 'svc-1',
        product: null,
        service: { id: 'svc-1', name: 'Implementation', description: 'SOW from service' },
        manDaySnapshot: [{ role: 'PM', dayRate: 3000, days: 5, subtotal: 15000 }],
      }),
    ).toBe('SOW from service');
  });

  it('returns null when nothing is available at any layer', () => {
    expect(
      resolveLineItemDescription({
        ...baseItem,
        description: null,
        product: { id: 'prod-1', name: 'X', sku: 'LIC-001' }, // no description
      }),
    ).toBeNull();
    expect(
      resolveLineItemDescription({
        ...baseItem,
        description: null,
        product: null, // deleted
      }),
    ).toBeNull();
  });
});
