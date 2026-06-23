/**
 * Regression test for P1-9 (commit fca07ee): the Companies / Deals /
 * Quotations list pages were missing delete + edit affordances. The
 * root cause was UI-only — the api.ts client had the right methods
 * all along — but this test pins the contract so a future refactor
 * of api.ts can't silently drop .remove() / .update() for the three
 * entities and leave the list pages stranded.
 *
 * Why smoke-level (not deep mock-fetch): the real risk is that the
 * method name changes; we just need to assert the surface exists.
 * Behavioural coverage lives in the manual / e2e flow.
 */

import { describe, it, expect } from 'vitest';
import { companiesApi, dealsApi, quotationsApi } from '../api';

describe('api.ts — list-page CRUD surface (P1-9 regression guard)', () => {
  describe('companiesApi', () => {
    it('exposes .remove(id) for the Companies list delete button', () => {
      expect(typeof companiesApi.remove).toBe('function');
    });
  });

  describe('dealsApi', () => {
    it('exposes .remove(id) for the Kanban delete button', () => {
      expect(typeof dealsApi.remove).toBe('function');
    });
  });

  describe('quotationsApi', () => {
    it('exposes .remove(id) for the Quotations list delete button', () => {
      expect(typeof quotationsApi.remove).toBe('function');
    });

    it('exposes .update(id, data) for the Quotations list edit button', () => {
      expect(typeof quotationsApi.update).toBe('function');
    });
  });
});
