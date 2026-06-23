/**
 * Pure-function tests for the QuotationBuilder autocomplete label logic
 * (P1-10). The bug: when a Product/Service was DELETED from the catalogue
 * or RENAMED after a Quotation line was created, opening the quotation
 * for edit showed a blank (deleted) or stale (renamed) autocomplete
 * input — silently overwriting the historical snapshot the customer was
 * quoted against.
 *
 * Fix: the `autocompleteLabel` and `isAutocompleteDeleted` helpers
 * exported from `quotation-builder.tsx` pin the precedence to
 * "snapshot wins, live is fallback" so a deleted or renamed record
 * never blanks the input nor changes what was quoted.
 *
 * Why pure-function tests (not RTL): the rendering — including the
 * "(已刪除)" badge, the input's `value` attribute, and the snapshot
 * precedence — is one tiny expression each. Pure-function tests give
 * us a fast, no-mock coverage of the core contract. The full visual
 * smoke is the manual checklist in the PR description.
 */

import { describe, it, expect } from 'vitest';
import { autocompleteLabel, isAutocompleteDeleted } from '../quotation-builder';

describe('autocompleteLabel (P1-10 — snapshot wins over live)', () => {
  it('returns the snapshotted sku + name when both are set', () => {
    expect(autocompleteLabel('Old Product', 'OLD-001', null)).toBe('OLD-001 — Old Product');
  });

  it('returns the snapshotted name alone when no snapshot sku (services)', () => {
    expect(autocompleteLabel('Old Service', undefined, null)).toBe('Old Service');
  });

  it('prefers snapshot over live when both exist (P1-10: renamed product)', () => {
    // The customer was quoted "Enterprise License" (snapshot) but the
    // catalogue record was later renamed to "Enterprise License v2".
    // The line must keep showing the snapshot, NOT the live name.
    expect(
      autocompleteLabel('Enterprise License', 'LIC-001', {
        name: 'Enterprise License v2',
        sku: 'LIC-001',
      }),
    ).toBe('LIC-001 — Enterprise License');
  });

  it('falls back to the live record when no snapshot is set (new line)', () => {
    // Create flow: user picks a product, applyProduct sets line.name
    // synchronously, but on first render the snapshot props are still
    // empty. We use the live catalogue as a fallback in that window.
    expect(
      autocompleteLabel(undefined, undefined, { name: 'New Product', sku: 'NEW-001' }),
    ).toBe('NEW-001 — New Product');
  });

  it('returns empty string when nothing is set', () => {
    expect(autocompleteLabel(undefined, undefined, null)).toBe('');
    expect(autocompleteLabel('', '', null)).toBe('');
  });

  it('uses the live SKU when only the snapshot name is set (defensive)', () => {
    // Shouldn't happen in practice (applyProduct always copies both),
    // but if the snapshot SKU is missing we don't want to drop the live
    // one — that would break the search-by-SKU UX.
    expect(
      autocompleteLabel('Old Product', undefined, { name: 'Old Product', sku: 'OLD-001' }),
    ).toBe('OLD-001 — Old Product');
  });
});

describe('isAutocompleteDeleted', () => {
  it('true when value is set but the live record is missing (P1-10: deleted product)', () => {
    expect(isAutocompleteDeleted('prod-123', null)).toBe(true);
    expect(isAutocompleteDeleted('prod-123', undefined)).toBe(true);
  });

  it('false when value is set and the live record is found', () => {
    expect(isAutocompleteDeleted('prod-123', { id: 'prod-123' })).toBe(false);
  });

  it('false when no value (no product picked yet → not deleted, just empty)', () => {
    expect(isAutocompleteDeleted(undefined, null)).toBe(false);
    expect(isAutocompleteDeleted('', null)).toBe(false);
  });
});
