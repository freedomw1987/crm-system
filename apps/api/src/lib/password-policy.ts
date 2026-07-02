// P1-5 (2026-06-08): strong password policy helper.
// Used by /auth/register and /auth/change-password.
//
// P3-i18n (2026-07-02): returns translation *keys* (the catalog
// names in lib/api-errors.ts) instead of hardcoded English strings.
// Callers translate via `tApi(locale, key)` so the same policy check
// surfaces localized errors in en / zh-TW / zh-CN. Login intentionally
// does not use this helper — see TECH-DEBT.md P1-5 for the rationale
// (existing user passwords below 12 chars are grandfathered until
// next login migration; see RG-006).
const SPECIAL_CHARS_PATTERN = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;

export type PasswordPolicyErrorKey =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_NEEDS_DIGIT'
  | 'PASSWORD_NEEDS_SPECIAL';

export const validateStrongPassword = (pw: string): PasswordPolicyErrorKey | null => {
  if (pw.length < 12) return 'PASSWORD_TOO_SHORT';
  if (!/[0-9]/.test(pw)) return 'PASSWORD_NEEDS_DIGIT';
  if (!SPECIAL_CHARS_PATTERN.test(pw)) return 'PASSWORD_NEEDS_SPECIAL';
  return null;
};
