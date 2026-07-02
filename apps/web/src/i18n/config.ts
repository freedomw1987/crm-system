/**
 * Shared i18n constants — imported by both the web client and any
 * future tooling (sync scripts, lint guards).
 *
 * Three locales (per the i18n plan):
 *   - en       — default
 *   - zh-TW    — Taiwan Traditional Chinese (baseline — most existing
 *                source code uses these strings verbatim)
 *   - zh-CN    — Mainland Simplified Chinese, generated from zh-TW via
 *                the curated substitution table in scripts/zh-tw-to-zh-cn.ts
 *
 * Both `locale` keys and namespace names are SCREAMING_SNAKE_CASE
 * strings so they match the shape of i18next's built-in tooling
 * (and the API-side api-errors keys they mirror).
 */

export const SUPPORTED_LNGS = ['en', 'zh-TW', 'zh-CN'] as const;
export type SupportedLng = (typeof SUPPORTED_LNGS)[number];

export const FALLBACK_LNG: SupportedLng = 'en';

/**
 * Phase 1 + Phase 2-4 namespaces — chrome + auth + role/status enums +
 * UI-only fallback errors + per-page chrome (dashboard, settings) +
 * high-traffic CRUD namespaces (company, deal, quotation). Each locale
 * ships all of these as bundled JSON (no async loading, no Suspense
 * complexity).
 */
export const NAMESPACES = [
  'common',
  'nav',
  'auth',
  'role',
  'status',
  'errors',
  'dashboard',
  'settings',
  'company',
  'deal',
  'quotation',
  'product',
  'service',
  'contact',
  'user',
  'audit',
  'ai',
  'activity',
  'attachment',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** localStorage key for the pre-login locale preference. */
export const LOCALE_STORAGE_KEY = 'crm:locale';
