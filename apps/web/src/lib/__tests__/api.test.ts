import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, setToken, ApiError } from '../api';

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
