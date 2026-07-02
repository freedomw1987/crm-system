/**
 * SettingsAccountPage — P3-i18n (2026-07-02).
 *
 * The "Account" tab inside `/settings`. Visible to ALL roles (admin
 * or not) — it's the per-user preference panel (language picker
 * today; future profile fields live here too).
 *
 * Why a tab with explicit Save instead of an auto-saving dropdown:
 *   - Locale is a persisted server-side preference, not a session
 *     toggle. Auto-saving on dropdown change creates two failure
 *     modes: silent failure if the network call drops, and one
 *     API call per click. Settings with explicit Save is the
 *     established pattern across this app (Tax, Currency,
 *     Maintenance Fee — all have Save buttons).
 *
 * Optimistic local swap: the `useAuth().setLocale()` action swaps
 * i18n immediately so the page re-renders in the chosen language
 * BEFORE the network round-trip completes. If the server rejects
 * (token expired / offline), the optimistic state stays (better
 * UX than flickering back) — the next bootstrap will reconcile.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/lib/auth';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import type { SupportedLng } from '@/i18n/config';
import { RoleBadge } from '@/components/role-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

export function SettingsAccountPage() {
  const { t } = useTranslation();
  const { user, setLocale } = useAuth();
  // Local staging state — reflects what the user has *picked* but
  // not yet *saved*. Saved-state comes from `user.locale`.
  const [pending, setPending] = useState<SupportedLng | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<'success' | 'error' | null>(null);

  // Reset pending whenever the persisted locale changes (e.g. another
  // tab saved it, or the user navigated away and came back).
  useEffect(() => {
    setPending(null);
  }, [user?.locale]);

  if (!user) {
    // Should be unreachable — RequireAuth guards /settings/*. Belt
    // and braces: render a minimal placeholder so the page never
    // throws if accessed during logout race.
    return null;
  }

  const draft = pending ?? (user.locale as SupportedLng | undefined) ?? 'en';
  const dirty = pending !== null && pending !== user.locale;

  async function handleSave() {
    if (!pending || !dirty) return;
    setSaving(true);
    setToast(null);
    try {
      await setLocale(pending);
      setToast('success');
      setPending(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('settings.account.saveFailed');
      // Inline error (not toast) — keeps the form in place for retry.
      setToast('error');
      console.error('[settings-account] save locale failed:', msg);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setPending(null);
    setToast(null);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Profile — read-only summary. Profile editing (name, avatar,
          password change) lives at future endpoints; for now we just
          surface the canonical values from the auth store. */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.account.profileSection')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-y-3 gap-x-6 text-sm">
            <dt className="text-muted-foreground">{t('settings.account.profileEmail')}</dt>
            <dd className="sm:col-span-2 font-medium break-all">{user.email}</dd>

            <dt className="text-muted-foreground">{t('settings.account.profileName')}</dt>
            <dd className="sm:col-span-2 font-medium">{user.name}</dd>

            <dt className="text-muted-foreground">{t('settings.account.profileRole')}</dt>
            <dd className="sm:col-span-2">
              <RoleBadge role={user.role} />
            </dd>
          </dl>
        </CardContent>
      </Card>

      {/* Language preference — the Phase-1 deliverable. The
          LanguageSwitcher swaps i18n locally as soon as the user
          picks, but the change is only persisted when they Save. */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.account.languageSection')}</CardTitle>
          <CardDescription>
            {t('settings.account.languageSectionDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <label
              htmlFor="locale-picker"
              className="text-sm font-medium min-w-[120px]"
            >
              {t('settings.account.languageLabel')}
            </label>
            <div id="locale-picker">
              <LanguageSwitcher
                onChange={(next) => {
                  setPending(next);
                  setToast(null);
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? t('settings.account.saving') : t('settings.account.save')}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={handleCancel} disabled={saving}>
                {t('common.cancel')}
              </Button>
            )}
            {toast === 'success' && (
              <span className="text-sm text-green-700" role="status">
                {t('settings.account.saved')}
              </span>
            )}
            {toast === 'error' && (
              <span className="text-sm text-destructive" role="status">
                {t('settings.account.saveFailed')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}