// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, setToken, ApiError } from '../api';

// Day 30: the suite runs in two environments — vitest with
// jsdom (per `bunx vitest run` in apps/web) and bun's test
// runner (per `bun test` from root). localStorage is jsdom-only;
// bun's runner has no DOM globals. Stub the global before the
// SUT's first call. The SUT reads localStorage lazily (in
// getToken() / setToken() bodies, not at module load), so a
// top-of-module assignment is fine.
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const _store = new Map<string, string>();
  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (_store.has(k) ? _store.get(k)! : null),
    setItem: (k: string, v: string) => { _store.set(k, String(v)); },
    removeItem: (k: string) => { _store.delete(k); },
    clear: () => { _store.clear(); },
  };
}

describe('api auth token helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no token is set', () => {
    expect(getToken()).toBeNull();
  });

  it('round-trips a token through setToken / getToken', () => {
    setToken('abc123');
    expect(getToken()).toBe('abc123');
  });

  it('setToken(null) clears the token', () => {
    setToken('abc123');
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

describe('ApiError', () => {
  it('preserves status and body', () => {
    const body = { error: 'Forbidden' };
    const err = new ApiError(403, body);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(403);
    expect(err.body).toBe(body);
  });

  it('uses a sensible default message', () => {
    const err = new ApiError(500, null);
    expect(err.message).toBe('API 500');
  });

  it('accepts a custom message override', () => {
    const err = new ApiError(401, null, 'Token expired');
    expect(err.message).toBe('Token expired');
  });
});
