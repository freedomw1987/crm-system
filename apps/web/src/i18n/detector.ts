/**
 * Custom locale detector — used by i18next during `init({ detection })`.
 *
 * Resolution order (first match wins):
 *   1. localStorage['crm:locale'] — explicit user choice from
 *      /settings/account (or the pre-login language picker on
 *      /login if we add one later).
 *   2. `navigator.language` — browser preference. We pick the
 *      best-supported match (exact > language-prefix > 'en').
 *   3. 'en' — hard fallback.
 *
 * Why a custom detector vs `i18next-browser-languagedetector`?
 *   - We only have three locales and a single tier of fallback; the
 *     detector package's built-in cookie/path/query detectors are
 *     useful for SSR but not for this SPA.
 *   - One-file, no opaque behavior. The order is auditable.
 *
 * i18next's detector API is `{ detect, cacheUserLanguage }` —
 * `detect()` returns the language string; `cacheUserLanguage` writes
 * back to localStorage on language change.
 */

import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LNGS,
  FALLBACK_LNG,
  type SupportedLng,
} from './config';

function isSupported(value: string | null | undefined): value is SupportedLng {
  return !!value && (SUPPORTED_LNGS as readonly string[]).includes(value);
}

/**
 * Best-match algorithm — given a free-form `navigator.language`
 * value (e.g. `'zh-TW'`, `'zh'`, `'en-US'`, `'en'`), return the
 * closest `SupportedLng`. Symmetric with the API-side
 * `parseAcceptLanguage` so the wire and the UI agree.
 */
function bestMatch(input: string | undefined): SupportedLng {
  if (!input) return FALLBACK_LNG;
  const lower = input.toLowerCase();
  // 1. Exact match (case-insensitive)
  const exact = SUPPORTED_LNGS.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  // 2. Language-only prefix: `zh` → prefer `zh-TW` (Taiwan default)
  const langOnly = lower.split('-')[0];
  if (langOnly === 'zh') return 'zh-TW';
  if (langOnly === 'en') return 'en';
  // 3. Default
  return FALLBACK_LNG;
}

export const localeDetector = {
  /**
   * Called by i18next on init. Returns the language string to use.
   */
  detect(): SupportedLng {
    // 1. localStorage — explicit user pick wins
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isSupported(stored)) return stored;
    } catch {
      // Some browsers (Safari private mode) throw on localStorage access;
      // fall through to the navigator check below.
    }
    // 2. Browser preference
    const nav = typeof navigator !== 'undefined' ? navigator.language : undefined;
    const matched = bestMatch(nav);
    // 3. Cache the matched language so subsequent bootstraps stay stable.
    //    (Skip on the very first read if we fell all the way through to
    //    'en' — users who haven't chosen shouldn't get their choice
    //    recorded as "explicit en". i18next will write back via
    //    cacheUserLanguage whenever changeLanguage() is called.)
    return matched;
  },

  /**
   * Called by i18next after language resolution (and on
   * `changeLanguage()`). Persist so the next reload is stable.
   */
  cacheUserLanguage(lng: string): void {
    if (!isSupported(lng)) return;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, lng);
    } catch {
      // No-op — failing to persist the choice shouldn't block init.
    }
  },

  // Names required by i18next-browser-languagedetector's interface —
  // exposes this object as an `services: { detector: ... }` rather
  // than a class.
  name: 'crmCustomDetector',
  type: 'languageDetector' as const,
};
