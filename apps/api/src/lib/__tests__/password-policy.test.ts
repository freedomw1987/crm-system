import { describe, expect, test } from 'bun:test';
import { validateStrongPassword } from '../password-policy';

describe('validateStrongPassword (P1-5)', () => {
  // --- length rule ---
  test('rejects password under 12 chars even if it has digit + special', () => {
    expect(validateStrongPassword('Aa1!')).toMatch(/12/);
    expect(validateStrongPassword('Ab1!cd2@ef')).toMatch(/12/);
  });

  test('rejects empty string', () => {
    expect(validateStrongPassword('')).toMatch(/12/);
  });

  // --- digit rule ---
  test('rejects 12+ chars with no digit', () => {
    expect(validateStrongPassword('abcdefghijkl!')).toMatch(/digit/);
  });

  // --- special char rule ---
  test('rejects 12+ chars with no special', () => {
    expect(validateStrongPassword('abcdefghijkl9')).toMatch(/special/);
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
    expect(validateStrongPassword('aA1!aA1!aA1')).toMatch(/12/);
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
