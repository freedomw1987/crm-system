import { create } from 'zustand';
import { authApi, setToken, getToken, type AuthUser } from './api';
import { i18n } from '../i18n';

/**
 * P3-i18n (2026-07-02): the auth store is the single point that
 * translates the DB-backed `users.locale` into an active i18next
 * language. Two flows feed it:
 *
 *   1. login() — `authApi.login` returns the fresh user; we mirror
 *      `user.locale` to `i18n.changeLanguage()`. Subsequent requests
 *      automatically pick the right Accept-Language header (see the
 *      request() helper in api.ts).
 *   2. bootstrap() — when the page reloads with a stored token, the
 *      /auth/me response carries the DB preference, so we sync again.
 *
 * setLocale() exists so the /settings/account page can update the
 * server (`PATCH /auth/me/preferences`) and then mirror to i18n in
 * one step, before the network round-trip completes (optimistic).
 */

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  bootstrapped: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  bootstrap: () => Promise<void>;
  /** Mirrors the user's locale to i18n + the auth store. Called by
   *  /settings/account on Save AND by setLocale from anywhere else. */
  setLocale: (locale: 'en' | 'zh-TW' | 'zh-CN') => Promise<void>;
}

/**
 * Side-effect-free helper: read the auth store from outside React.
 * Useful for non-component code (e.g., the boot path that needs to
 * know whether a token is present before deciding to call
 * `bootstrap()`).
 */
async function syncI18n(user: AuthUser | null): Promise<void> {
  if (!user?.locale) return;
  // Skip if already in the right language — i18next fires
  // `languageChanged` on every change, and the side-effect (localStorage
  // write) is harmless but wasteful.
  if (i18n.language === user.locale) return;
  await i18n.changeLanguage(user.locale);
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  bootstrapped: false,

  async login(email, password) {
    set({ loading: true });
    try {
      const { token, user } = await authApi.login(email, password);
      setToken(token);
      set({ user, loading: false });
      // Sync i18n to the persisted preference (changes the active
      // namespace on the very first paint of the post-login UI).
      await syncI18n(user);
      return user;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  logout() {
    setToken(null);
    set({ user: null });
    // Don't reset i18n — pre-login locale should survive logout so
    // the user lands on /login in their preferred language. If a
    // future flow needs a "fresh sign-out", expose a separate
    // `resetLanguage()` action rather than swallowing it here.
  },

  async bootstrap() {
    if (!getToken()) {
      set({ bootstrapped: true });
      return;
    }
    try {
      const user = await authApi.me();
      set({ user, bootstrapped: true });
      await syncI18n(user);
    } catch {
      setToken(null);
      set({ user: null, bootstrapped: true });
    }
  },

  async setLocale(locale) {
    const user = get().user;
    if (!user) {
      // Not logged in — just change i18n. The detector already
      // mirrors to localStorage.
      await i18n.changeLanguage(locale);
      return;
    }
    // Optimistic local swap first; the network call follows.
    await i18n.changeLanguage(locale);
    // Mirror into the auth store so /me and login responses stay
    // in sync without refetching.
    set({ user: { ...user, locale } });
    try {
      const { user: fresh } = await authApi.updatePreferences({ locale });
      // Server is the source of truth — replace with its response.
      set({ user: fresh });
    } catch (err) {
      // The optimistic swap stays in effect (better UX than
      // flickering back to the previous language on transient
      // errors). The next bootstrap will reconcile.
      throw err;
    }
  },
}));
