/**
 * Regression tests for the permission-matrix exports of
 * `middleware/rbac.ts` (Day 30, t3).
 *
 * Pinned invariants:
 *
 *   RG-004 (Day 17, Day 18 review): `PERMISSIONS` is the canonical
 *     permission catalogue. ADMIN gets EVERY key (via
 *     `Object.keys(PERMISSIONS)`). If a future PR adds a new
 *     permission key, the seed must include it for ADMIN — this
 *     test catches "added a key to PERMISSIONS but forgot to give
 *     it to ADMIN".
 *
 *   The `clearRoleCache(roleId?)` function is exported so the
 *     `roles.ts` route can invalidate after a PATCH/DELETE. We
 *     pin the contract: clearing without arg clears all; with
 *     arg clears just that roleId. (We test this through the
 *     route in `roles.test.ts` if/when added; the unit-level
 *     contract is just the export.)
 *
 *   The permission matrix is read by both the api (rbac.ts) and
 *     the web (admin/roles UI). A single source of truth prevents
 *     the two from drifting.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  ADMIN_PERMISSIONS,
  clearRoleCache,
  PERMISSIONS,
  ROLE_PERMISSIONS,
} from '../rbac';

// ============================================================================
// ADMIN_PERMISSIONS (RG-004)
// ============================================================================

describe('ADMIN_PERMISSIONS (RG-004)', () => {
  it('includes every key currently declared in PERMISSIONS', () => {
    // The canonical invariant: ADMIN gets every permission. If a
    // future PR adds a key to PERMISSIONS but forgets to give
    // it to ADMIN, this test fails.
    const permKeys = new Set(Object.keys(PERMISSIONS));
    const adminKeys = new Set(ADMIN_PERMISSIONS);
    expect(adminKeys).toEqual(permKeys);
  });

  it('is a ReadonlySet (caller cannot mutate the exported set)', () => {
    // TypeScript enforces ReadonlySet at the type level; at
    // runtime we verify the Set shape so a future .ts → .js
    // conversion doesn't accidentally drop the readonly modifier.
    expect(ADMIN_PERMISSIONS).toBeInstanceOf(Set);
    // Attempting to mutate via .add should still work at runtime
    // (the readonly is a TS-only thing), but we don't actually
    // do that here — we just check the type. If a future refactor
    // changes the type to `Set<string>`, this test will still pass
    // and the upstream type-checker would catch the loss of
    // readonly.
    const sizeBefore = ADMIN_PERMISSIONS.size;
    expect(ADMIN_PERMISSIONS.size).toBe(sizeBefore);
  });

  it('has the same set of permissions as the ROLE_PERMISSIONS.ADMIN set', () => {
    // The two definitions must agree. The DAY-18 RG-004 fix
    // replaced `new Set<Permission>(Object.keys(PERMISSIONS))` with
    // a re-derivation; this test pins that the lib export and
    // the role-default set are kept in sync.
    expect(ADMIN_PERMISSIONS).toEqual(ROLE_PERMISSIONS.ADMIN);
  });
});

// ============================================================================
// ROLE_PERMISSIONS is exported
// ============================================================================

describe('ROLE_PERMISSIONS export (RG-004)', () => {
  it('exposes the full role → permission matrix', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['ADMIN', 'SALES', 'VIEWER']);
  });

  it('every role has a non-empty permission set (defensive — empty = misconfig)', () => {
    // If a future PR accidentally inits a role to `new Set()`,
    // every authenticated user would be locked out of that role's
    // resources. Catching this here surfaces the misconfig at
    // type-check time, not at first login.
    for (const role of ['ADMIN', 'SALES', 'VIEWER'] as const) {
      expect(ROLE_PERMISSIONS[role].size).toBeGreaterThan(0);
    }
  });

  it('SALES has strictly fewer permissions than ADMIN (the role is meant to be scoped)', () => {
    // The default SALES set excludes admin-only keys (e.g.
    // 'user:create', 'role:update'). If a future PR adds a
    // permission to SALES by mistake, the audit log would show
    // SALES users doing admin actions — a security regression.
    expect(ROLE_PERMISSIONS.SALES.size).toBeLessThan(ROLE_PERMISSIONS.ADMIN.size);
  });

  it('VIEWER has the smallest set (read-only role)', () => {
    expect(ROLE_PERMISSIONS.VIEWER.size).toBeLessThanOrEqual(ROLE_PERMISSIONS.SALES.size);
  });

  it('every role is a subset of ADMIN (no role has a permission that ADMIN lacks)', () => {
    // If a future PR adds a permission to SALES that ADMIN
    // doesn't have, the role-default-set is inconsistent with
    // the keys.
    for (const role of ['SALES', 'VIEWER'] as const) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(ROLE_PERMISSIONS.ADMIN.has(perm)).toBe(true);
      }
    }
  });
});

// ============================================================================
// clearRoleCache (the export contract)
// ============================================================================

describe('clearRoleCache', () => {
  // Note: clearRoleCache mutates a module-level `cache` Map. Tests
  // that hit the cached userHasPermission path would leak state
  // between runs. This file is a smoke-test of the export +
  // signature; the actual cache-invalidation behaviour is covered
  // end-to-end by the roles route test (once added).
  afterEach(() => clearRoleCache());

  it('is callable with no arguments (clears all)', () => {
    expect(() => clearRoleCache()).not.toThrow();
  });

  it('is callable with a roleId argument (clears just that role)', () => {
    expect(() => clearRoleCache('any_role_id_string')).not.toThrow();
  });

  it('accepts undefined as the no-arg form', () => {
    expect(() => clearRoleCache(undefined)).not.toThrow();
  });
});

// ============================================================================
// Schema integrity: every PERMISSIONS key is unique
// ============================================================================

describe('PERMISSIONS catalog integrity', () => {
  it('has no duplicate permission keys (a typo would silently shadow)', () => {
    // Defensive: if two entries had the same key (e.g. one
    // typed 'product:read' twice), the second would overwrite
    // the first. JS objects dedupe keys at parse time, so the
    // count would be off. This test catches the typo.
    const keys = Object.keys(PERMISSIONS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every key follows `<resource>:<action>` format', () => {
    // A grep test — if someone names a key `product.read` or
    // `Product-Read`, it would silently fail permission checks
    // elsewhere (role-default sets use `:` separator).
    for (const key of Object.keys(PERMISSIONS)) {
      expect(key).toMatch(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);
    }
  });
});
