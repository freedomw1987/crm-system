/**
 * API-side i18n helper.
 *
 * Why a hand-rolled `tApi` instead of i18next:
 *   - The API only ever emits ~80 short error strings (per the
 *     investigation in REGRESSION-GUARD.md). A full i18next
 *     instance per request is overkill — this is a 30-line lookup
 *     over per-locale TS maps.
 *   - The wire format is `{ error: "..." }`. Keeping the catalog
 *     local to each locale (not in JSON fetched at runtime) means
 *     no extra build step and zero dependency on a translations
 *     pipeline.
 *   - `tApi(locale, key, vars?)` falls back to English when a key
 *     is missing in the active locale — so a partially-translated
 *     catalog still produces a sane error rather than a `undefined`.
 *
 * Both `apps/api` and `apps/web` import `SupportedLocale` and
 * `SUPPORTED_LOCALES` from `@crm/shared/i18n` so the wire enum is
 * guaranteed to stay in sync.
 */

import {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  DEFAULT_LOCALE,
  type SupportedLocale,
} from '@crm/shared/i18n';

import { apiErrorsEn } from './api-errors.en';
import { apiErrorsZhTw } from './api-errors.zh-TW';
import { apiErrorsZhCn } from './api-errors.zh-CN';
import type { ApiErrorMessages } from './api-errors';

export { SUPPORTED_LOCALES, DEFAULT_LOCALE, isSupportedLocale };
export type { SupportedLocale };

/**
 * Look up the catalog for a locale, falling back to English when
 * the locale is unknown. Always returns a usable map (never null).
 */
function getCatalog(locale: SupportedLocale | undefined): ApiErrorMessages {
  switch (locale) {
    case 'zh-TW':
      return apiErrorsZhTw;
    case 'zh-CN':
      return apiErrorsZhCn;
    case 'en':
    default:
      return apiErrorsEn;
  }
}

/**
 * Render an error template, interpolating `{{var}}` placeholders.
 * Missing variables are left as the literal `{{var}}` so it's
 * obvious in logs what was missing — better than silently dropping
 * them.
 *
 * Example:
 *   tApi('en', 'QUOTATION_SENT_LOCK', { status: 'SENT' })
 *   → 'Quotation is SENT and cannot be edited. Create a revision instead.'
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in vars ? String(vars[key]) : match;
  });
}

/**
 * Look up an error message in the catalog for the given locale.
 *
 * - Falls back to English when `locale` is not a SupportedLocale
 *   (defensive — the DB column is a plain String so a bad write
 *   could surface here).
 * - Falls back to the key itself (with the `MISSING_` prefix) when
 *   the key isn't in the catalog — this surfaces translation gaps
 *   in the logs rather than shipping `undefined` to the client.
 *
 * Usage in routes:
 *   return { error: tApi(ctx.locale, 'NOT_FOUND') };
 *   return { error: tApi(ctx.locale, 'QUOTATION_SENT_LOCK', { status: q.status }) };
 */
export function tApi(
  locale: SupportedLocale | string | undefined,
  key: keyof ApiErrorMessages,
  vars?: Record<string, string | number>,
): string {
  const safeLocale: SupportedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  const catalog = getCatalog(safeLocale);
  const template = catalog[key] ?? apiErrorsEn[key] ?? `MISSING_${key}`;
  return interpolate(template, vars);
}

/**
 * Parse an `Accept-Language` header and return the best matching
 * supported locale. Per RFC 7231 the header is a comma-separated
 * list with optional `;q=0.x` quality scores:
 *
 *   "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
 *
 * Strategy:
 *   1. Split on `,`, strip whitespace, split each entry on `;q=`.
 *   2. Sort by quality (default 1.0) descending.
 *   3. For each entry: try exact match (`zh-TW`), then language-only
 *      prefix match (`zh` → prefer `zh-TW` over `zh-CN` per
 *      Taiwanese-Mandarin-first policy).
 *   4. Fall back to `DEFAULT_LOCALE`.
 *
 * Returns `SupportedLocale` (never undefined) so callers can use
 * the result without a runtime check.
 */
export function parseAcceptLanguage(header: string | null | undefined): SupportedLocale {
  if (!header) return DEFAULT_LOCALE;

  const entries = header
    .split(',')
    .map((raw) => {
      const [tag, ...params] = raw.trim().split(';');
      const lang = tag.trim();
      let q = 1;
      for (const p of params) {
        const m = p.trim().match(/^q\s*=\s*([0-9.]+)$/);
        if (m) q = parseFloat(m[1]);
      }
      return { lang: lang.toLowerCase(), q };
    })
    .filter((e) => e.lang && !Number.isNaN(e.q))
    .sort((a, b) => b.q - a.q);

  for (const e of entries) {
    // Exact match (case-insensitive)
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === e.lang);
    if (exact) return exact;
    // Language-only prefix match: `zh` → prefer `zh-TW` (Taiwan default)
    const langOnly = e.lang.split('-')[0];
    if (langOnly === 'zh') {
      return 'zh-TW';
    }
    // `en-us` etc → English
    if (langOnly === 'en') return 'en';
  }
  return DEFAULT_LOCALE;
}