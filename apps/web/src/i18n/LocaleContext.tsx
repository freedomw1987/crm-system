/**
 * `<LocaleProvider>` — thin React wrapper around i18next.
 *
 * The `initReactI18next` plugin already injects `useTranslation()`
 * hooks with proper React integration; the only state this provider
 * adds is a `changeLocale()` action that ALSO mirrors the choice to
 * localStorage (so the user can pick their language pre-login and
 * have it survive the round trip to /auth/login).
 *
 * Why a separate provider?
 *   - App.tsx wraps the router in `<LocaleProvider>` so the
 *     `useLocale()` hook is reachable from anywhere below. Reads
 *     the actual i18n instance from `useContext`.
 *   - Keeps the `useLocale()` API surface small and explicit; the
 *     alternative (asking every component to call `useTranslation()`)
 *     is fine but spreads `i18n` access points across the tree.
 */

import { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { i18n } from './index';
import { SUPPORTED_LNGS, type SupportedLng } from './config';

type LocaleContextValue = {
  /** Current locale (always a SupportedLng — never undefined). */
  locale: SupportedLng;
  /** All locales the UI offers in the picker, in stable order. */
  locales: readonly SupportedLng[];
  /** Change the active locale AND mirror to localStorage. */
  changeLocale: (next: SupportedLng) => Promise<void>;
  /** react-i18next's `t` — kept here for ergonomics. */
  t: ReturnType<typeof useTranslation>['t'];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { t, i18n: i18nInstance } = useTranslation();

  const locale = (i18nInstance.language as SupportedLng) ?? 'en';
  const locales = SUPPORTED_LNGS;

  const changeLocale = useCallback(async (next: SupportedLng) => {
    if (!SUPPORTED_LNGS.includes(next)) return;
    await i18n.changeLanguage(next);
    // i18next's `languageChanged` listener (wired in index.ts) handles
    // the localStorage write — no need to repeat here.
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, locales, changeLocale, t }),
    [locale, changeLocale, t]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error(
      'useLocale() called outside <LocaleProvider>. Wrap your tree in <LocaleProvider> in App.tsx.'
    );
  }
  return ctx;
}
