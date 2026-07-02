/**
 * i18n bootstrap — call `initI18n()` once from main.tsx BEFORE
 * `createRoot().render(...)`. Synchronous: every locale+namespace
 * resource is statically imported so we don't need
 * `<React.Suspense>` boundaries or `useSuspense: true`.
 *
 * Resource bundles live under `apps/web/src/locales/<lng>/<ns>.json`.
 * They're imported eagerly — this pushes ~50 KB of JSON into the
 * initial bundle, which is acceptable for the CRM's size profile
 * and avoids runtime fetch failures.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  SUPPORTED_LNGS,
  FALLBACK_LNG,
  NAMESPACES,
  LOCALE_STORAGE_KEY,
  type SupportedLng,
  type Namespace,
} from './config';
import { localeDetector } from './detector';

import enCommon from '../locales/en/common.json';
import enNav from '../locales/en/nav.json';
import enAuth from '../locales/en/auth.json';
import enRole from '../locales/en/role.json';
import enStatus from '../locales/en/status.json';
import enErrors from '../locales/en/errors.json';
import enDashboard from '../locales/en/dashboard.json';
import enSettings from '../locales/en/settings.json';
import enActivity from '../locales/en/activity.json';
import enCompany from '../locales/en/company.json';
import enDeal from '../locales/en/deal.json';
import enQuotation from '../locales/en/quotation.json';
import enProduct from '../locales/en/product.json';
import enService from '../locales/en/service.json';
import enContact from '../locales/en/contact.json';
import enUser from '../locales/en/user.json';
import enAudit from '../locales/en/audit.json';
import enAi from '../locales/en/ai.json';
import enAttachment from '../locales/en/attachment.json';

import zhTwCommon from '../locales/zh-TW/common.json';
import zhTwNav from '../locales/zh-TW/nav.json';
import zhTwAuth from '../locales/zh-TW/auth.json';
import zhTwRole from '../locales/zh-TW/role.json';
import zhTwStatus from '../locales/zh-TW/status.json';
import zhTwErrors from '../locales/zh-TW/errors.json';
import zhTwDashboard from '../locales/zh-TW/dashboard.json';
import zhTwSettings from '../locales/zh-TW/settings.json';
import zhTwActivity from '../locales/zh-TW/activity.json';
import zhTwCompany from '../locales/zh-TW/company.json';
import zhTwDeal from '../locales/zh-TW/deal.json';
import zhTwQuotation from '../locales/zh-TW/quotation.json';
import zhTwProduct from '../locales/zh-TW/product.json';
import zhTwService from '../locales/zh-TW/service.json';
import zhTwContact from '../locales/zh-TW/contact.json';
import zhTwUser from '../locales/zh-TW/user.json';
import zhTwAudit from '../locales/zh-TW/audit.json';
import zhTwAi from '../locales/zh-TW/ai.json';
import zhTwAttachment from '../locales/zh-TW/attachment.json';

import zhCnCommon from '../locales/zh-CN/common.json';
import zhCnNav from '../locales/zh-CN/nav.json';
import zhCnAuth from '../locales/zh-CN/auth.json';
import zhCnRole from '../locales/zh-CN/role.json';
import zhCnStatus from '../locales/zh-CN/status.json';
import zhCnErrors from '../locales/zh-CN/errors.json';
import zhCnDashboard from '../locales/zh-CN/dashboard.json';
import zhCnSettings from '../locales/zh-CN/settings.json';
import zhCnActivity from '../locales/zh-CN/activity.json';
import zhCnCompany from '../locales/zh-CN/company.json';
import zhCnDeal from '../locales/zh-CN/deal.json';
import zhCnQuotation from '../locales/zh-CN/quotation.json';
import zhCnProduct from '../locales/zh-CN/product.json';
import zhCnService from '../locales/zh-CN/service.json';
import zhCnContact from '../locales/zh-CN/contact.json';
import zhCnUser from '../locales/zh-CN/user.json';
import zhCnAudit from '../locales/zh-CN/audit.json';
import zhCnAi from '../locales/zh-CN/ai.json';
import zhCnAttachment from '../locales/zh-CN/attachment.json';

// ─── Resource map ───────────────────────────────────────────────────
// Type-erased to `any` at the bundle boundary because JSON imports
// don't carry their key set into the type system. Consumers go
// through `t()` which is fully typed against the union of namespaces.

const en = {
  common: enCommon,
  nav: enNav,
  auth: enAuth,
  role: enRole,
  status: enStatus,
  errors: enErrors,
  dashboard: enDashboard,
  settings: enSettings,
  activity: enActivity,
  company: enCompany,
  deal: enDeal,
  quotation: enQuotation,
  product: enProduct,
  service: enService,
  contact: enContact,
  user: enUser,
  audit: enAudit,
  ai: enAi,
  attachment: enAttachment,
} as const;

const zhTW = {
  common: zhTwCommon,
  nav: zhTwNav,
  auth: zhTwAuth,
  role: zhTwRole,
  status: zhTwStatus,
  errors: zhTwErrors,
  dashboard: zhTwDashboard,
  settings: zhTwSettings,
  activity: zhTwActivity,
  company: zhTwCompany,
  deal: zhTwDeal,
  quotation: zhTwQuotation,
  product: zhTwProduct,
  service: zhTwService,
  contact: zhTwContact,
  user: zhTwUser,
  audit: zhTwAudit,
  ai: zhTwAi,
  attachment: zhTwAttachment,
} as const;

const zhCN = {
  common: zhCnCommon,
  nav: zhCnNav,
  auth: zhCnAuth,
  role: zhCnRole,
  status: zhCnStatus,
  errors: zhCnErrors,
  dashboard: zhCnDashboard,
  settings: zhCnSettings,
  activity: zhCnActivity,
  company: zhCnCompany,
  deal: zhCnDeal,
  quotation: zhCnQuotation,
  product: zhCnProduct,
  service: zhCnService,
  contact: zhCnContact,
  user: zhCnUser,
  audit: zhCnAudit,
  ai: zhCnAi,
  attachment: zhCnAttachment,
} as const;

// i18next's resource shape: `{ [lng]: { [namespace]: bundle } }`.
// The bundles (`en`, `zhTW`, `zhCN`) ARE the namespace maps — so
// we put them directly under each locale. Wrapping in
// `{ translation: en }` (the legacy single-namespace shape) would
// nest every key under the wrong namespace and cause every
// cross-namespace lookup to miss.
const resources = {
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
};

/**
 * Initialise the i18next instance.
 *
 * Idempotent: re-calling is a no-op (i18next detects the previous
 * init). The first call MUST happen before `createRoot().render()`
 * so the first render sees the active language already.
 */
export function initI18n(): typeof i18n {
  if (i18n.isInitialized) return i18n;

  // Manually run the detector so the initial language comes from
  // localStorage → navigator.language → 'en'. (We don't wire
  // `i18next-browser-languagedetector` as a plugin because we only
  // use the localStorage layer, and that plugin's detection config
  // is more verbose than reading localStorage ourselves.)
  const initialLng = localeDetector.detect();

  i18n
    // No backend, no Suspense — resources ship synchronously.
    .use(initReactI18next)
    .init({
      resources,
      lng: initialLng,
      fallbackLng: FALLBACK_LNG,
      supportedLngs: SUPPORTED_LNGS as unknown as string[],
      // We declare namespaces as a flat array; the `defaultNS` below
      // sets the implicit one for `t('save')` calls.
      ns: NAMESPACES as unknown as string[],
      defaultNS: 'common',
      // react-i18next recommends useSuspense: false for non-async
      // setups so missing keys render as the key, not a thrown promise.
      react: { useSuspense: false },
      // No need for nested keys; flat dot-paths (`status.quotation.DRAFT`)
      // are used so the catalogs stay greppable.
      keySeparator: '.',
      // Keep UI interpolators explicit (`{{name}}`); `:` would let
      // us use ICU plurals but adds runtime cost and we don't use it.
      interpolation: { escapeValue: false },
    });

  // P3-i18n fix (2026-07-02): wrap `i18n.t` so the call style
  // `t('dashboard.title')` resolves as `dashboard:title` (NOT
  // `common.dashboard.title`). i18next's defaultNS + keySeparator
  // would otherwise look in the `common` namespace for the literal
  // key `dashboard.title` and miss every cross-namespace key.
  //
  // The rule: if the FIRST dot-separated segment of the key matches
  // a registered namespace AND the caller didn't pass an explicit
  // `ns` option, rewrite as `<ns>:<rest>`. Otherwise pass through
  // unchanged — so nested keys like `dialog.matrix.selectedCount`
  // (where 'dialog' is NOT a registered namespace) still work.
  //
  // Implementation: replace `i18n.t` with a wrapper. react-i18next's
  // `useTranslation()` reads from `i18n` on every render, so this
  // wrapper covers all ~900 call sites without touching them.
  const NAMESPACES_SET: ReadonlySet<string> = new Set(NAMESPACES);
  const originalT = i18n.t.bind(i18n) as typeof i18n.t;
  const smartT = function smartT(
    key: string | string[],
    options?: Record<string, unknown>,
  ): string | string[] {
    const opts = options as { ns?: unknown } | undefined;
    // Caller passed an explicit namespace — honor it as-is.
    if (opts && typeof opts.ns === 'string' && opts.ns.length > 0) {
      return originalT(key as string, options);
    }
    // Array form (i18next plural key) — recurse per-element so each
    // gets its own prefix resolution.
    if (Array.isArray(key)) {
      return key.map((k) => smartT(k, options) as string);
    }
    const firstDot = key.indexOf('.');
    if (firstDot <= 0) return originalT(key, options);
    const head = key.slice(0, firstDot);
    if (!NAMESPACES_SET.has(head)) return originalT(key, options);
    const rest = key.slice(firstDot + 1);
    if (rest.length === 0) return originalT(key, options);
    return originalT(`${head}:${rest}`, options);
  };
  // `i18n.t` is a property of the i18n instance. Replace in place so
  // both `i18n.t(...)` and react-i18next's `useTranslation().t(...)`
  // see the wrapped version (react-i18next reads `i18n.t` at call
  // time, not at hook time).
  (i18n as unknown as { t: typeof smartT }).t = smartT;

  // Persist any language chosen (including the auto-detected one) so
  // reloads are stable. Mirrors `localeDetector.cacheUserLanguage` —
  // called once at boot AND on every `changeLanguage()` (see below).
  localeDetector.cacheUserLanguage(i18n.language);

  // Wire cacheUserLanguage to i18next's language change events so
  // any `i18n.changeLanguage(...)` call (login, settings save) also
  // updates localStorage.
  i18n.on('languageChanged', (lng) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, lng);
    } catch {
      // Private-mode Safari — fall through silently.
    }
  });

  return i18n;
}

/**
 * Re-export the `i18n` instance so consumers can call
 * `i18n.changeLanguage()` outside React (e.g. after `PATCH
 * /auth/me/preferences` succeeds).
 */
export { i18n };
export default i18n;

// Re-export namespace union for downstream typing.
export type { SupportedLng, Namespace };
