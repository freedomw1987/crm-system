/**
 * Shared i18n types — consumed by both `apps/api` and `apps/web`
 * so the wire format for `locale` is identical everywhere.
 *
 * Adding a new locale here is a 3-step change:
 *   1. Add to `SUPPORTED_LOCALES` below.
 *   2. Create `apps/api/src/lib/api-errors.<locale>.ts` catalog.
 *   3. Create `apps/web/src/locales/<locale>/...` JSON tree.
 *
 * The Postgres `users.locale` column is a plain `String` (not enum)
 * so the DB doesn't need a migration when locales grow. The API
 * validates the value via the `LocaleSchema` zod enum on
 * PATCH /auth/me/preferences — unknown values are rejected at the
 * boundary and never reach the DB.
 */

export const SUPPORTED_LOCALES = ['en', 'zh-TW', 'zh-CN'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Type guard for runtime narrowing (e.g. when reading a locale
 * string from `Accept-Language` or a DB row that predates the
 * Zod validation).
 */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export const DEFAULT_LOCALE: SupportedLocale = 'en';