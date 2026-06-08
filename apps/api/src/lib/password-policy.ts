// P1-5 (2026-06-08): strong password policy helper.
// Used by /auth/register and /auth/change-password.
//
// Returns null if valid, or a human-readable error string explaining
// the first failed rule. Login intentionally does not use this
// helper — see TECH-DEBT.md P1-5 for the rationale (existing user
// passwords below 12 chars are grandfathered until next login
// migration; see RG-006).
const SPECIAL_CHARS_PATTERN = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;

export const validateStrongPassword = (pw: string): string | null => {
  if (pw.length < 12) return 'Password must be at least 12 characters';
  if (!/[0-9]/.test(pw)) return 'Password must contain at least one digit';
  if (!SPECIAL_CHARS_PATTERN.test(pw))
    return 'Password must contain at least one special character';
  return null;
};
