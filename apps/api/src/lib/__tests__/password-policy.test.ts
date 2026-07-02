import { describe, expect, test } from 'bun:test';
import { validateStrongPassword, type PasswordPolicyErrorKey } from '../password-policy';
import { tApi } from '../../lib/i18n';
import type { ApiErrorMessages } from '../api-errors';

// P3-i18n (2026-07-02): the helper now returns translation KEYS, not
// English strings. These tests assert (a) the helper returns the
// expected key for each failure mode, and (b) the keys translate
// correctly through tApi() so the runtime user-facing strings stay
// in lock-step with the en / zh-TW / zh-CN catalogs.

const assertLocalizedAs = (key: PasswordPolicyErrorKey, enContains: string): void => {
  // English translation must contain the legacy substring the old
  // tests asserted on — that's what the API still returned to
  // pre-i18n clients and what operators expect to see in logs.
  expect(tApi('en', key as keyof ApiErrorMessages)).toContain(enContains);
  // zh-TW and zh-CN catalogs must define every key (no fallback to
  // English in production).
  expect(tApi('zh-TW', key as keyof ApiErrorMessages)).toBeTruthy();
  expect(tApi('zh-CN', key as keyof ApiErrorMessages)).toBeTruthy();
};

describe('validateStrongPassword (P1-5 + P3-i18n)', () => {
  // --- length rule ---
  test('rejects password under 12 chars even if it has digit + special', () => {
    expect(validateStrongPassword('Aa1!')).toBe('PASSWORD_TOO_SHORT');
    expect(validateStrongPassword('Ab1!cd2@ef')).toBe('PASSWORD_TOO_SHORT');
    assertLocalizedAs('PASSWORD_TOO_SHORT', '12');
  });

  test('rejects empty string', () => {
    expect(validateStrongPassword('')).toBe('PASSWORD_TOO_SHORT');
  });

  // --- digit rule ---
  test('rejects 12+ chars with no digit', () => {
    expect(validateStrongPassword('abcdefghijkl!')).toBe('PASSWORD_NEEDS_DIGIT');
    assertLocalizedAs('PASSWORD_NEEDS_DIGIT', 'digit');
  });

  // --- special char rule ---
  test('rejects 12+ chars with no special', () => {
    expect(validateStrongPassword('abcdefghijkl9')).toBe('PASSWORD_NEEDS_SPECIAL');
    assertLocalizedAs('PASSWORD_NEEDS_SPECIAL', 'special');
  });

  test('accepts a 12-char password with digit and special', () => {
    expect(validateStrongPassword('Abcdefghij1!')).toBeNull();
  });

  test('accepts a long passphrase with digit and special', () => {
    expect(validateStrongPassword('correct-horse-battery-9!')).toBeNull();
  });

  // --- boundary ---
  test('accepts exactly 12 chars with digit and special', () => {
    // 12 chars: aA1!aA1!aA1!
    expect(validateStrongPassword('aA1!aA1!aA1!')).toBeNull();
  });

  test('rejects 11 chars even if otherwise valid', () => {
    // 11 chars: aA1!aA1!aA1 (one char short of the example above)
    expect(validateStrongPassword('aA1!aA1!aA1')).toBe('PASSWORD_TOO_SHORT');
  });

  // --- special char coverage ---
  test.each([
    '!', '@', '#', '$', '%', '^', '&', '*', '(', ')',
    '_', '+', '-', '=', '[', ']', '{', '}', ';', ':',
    "'", '"', '\\', '|', ',', '.', '<', '>', '/', '?',
    '`', '~',
  ])('accepts special char %s', (special) => {
    expect(validateStrongPassword(`aA1${special}abcdefgh`)).toBeNull();
  });
});
