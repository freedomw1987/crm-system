import { useState, useEffect } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Save, AlertTriangle, History, Coins } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { settingsApi } from '@/lib/api';
import type { CurrencyConfig } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

/**
 * P2 multi-currency (2026-06-29) — System Settings → Currency tab.
 *
 * Two responsibilities:
 *   1. Pick the default billing currency (RMB / HKD / MOP).
 *      New Quotation rows default to this; sales reps can override
 *      per-quote in the builder.
 *   2. Set the two RMB-anchored exchange rates (1 RMB = X foreign).
 *      These are snapshotted on every Quotation at save time so
 *      the customer's HKD-equivalent is decoupled from later rate
 *      changes. MOP→HKD is derived at save time as (RMB→HKD / RMB→MOP).
 *
 * Permission: matches SettingsTaxPage — `settings:update` is enforced
 * server-side; non-admins see the current values (GET is auth-only)
 * but the Save button is hidden + the PUT will 403 if they try.
 *
 * Audit: every PUT emits a `SYSTEM_CONFIG_UPDATED` row with
 * `metadata: { key: 'currency_config', oldValue, newValue }`.
 */
export function SettingsCurrencyPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['settings', 'currency'],
    queryFn: () => settingsApi.getCurrency(),
  });

  // Local edit buffer — bound to the inputs, committed on Save.
  // We use strings for the rates (matches the existing TaxConfig
  // pattern) to avoid losing precision through Number coercion.
  const [draftDefault, setDraftDefault] = useState<'RMB' | 'HKD' | 'MOP'>('RMB');
  const [draftHkdRate, setDraftHkdRate] = useState<string>('');
  const [draftMopRate, setDraftMopRate] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Seed the drafts when the server value first loads.
  useEffect(() => {
    if (data) {
      setDraftDefault(data.default);
      setDraftHkdRate(String(data.rates['RMB->HKD']));
      setDraftMopRate(String(data.rates['RMB->MOP']));
    }
  }, [data]);

  // Explicit generic on useMutation so `updated` flows back as
  // CurrencyConfig (not unknown) — mirrors the type-safe pattern the
  // tax page uses after the same refactor.
  const saveMutation = useMutation<CurrencyConfig, Error>({
    mutationFn: () => {
      const hkd = Number(draftHkdRate);
      const mop = Number(draftMopRate);
      // Form-level validation (server re-validates via TypeBox).
      if (!Number.isFinite(hkd) || hkd <= 0) throw new Error(t('settings.currency.errors.rmbToHkdInvalid'));
      if (!Number.isFinite(mop) || mop <= 0) throw new Error(t('settings.currency.errors.rmbToMopInvalid'));
      return settingsApi.putCurrency({
        default: draftDefault,
        rates: { 'RMB->HKD': hkd, 'RMB->MOP': mop },
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<CurrencyConfig>(['settings', 'currency'], updated);
      setDraftDefault(updated.default);
      setDraftHkdRate(String(updated.rates['RMB->HKD']));
      setDraftMopRate(String(updated.rates['RMB->MOP']));
      setValidationError(null);
      setSavedAt(updated.updatedAt ?? new Date().toISOString());
    },
    onError: (e: Error) => {
      setValidationError(e.message);
    },
  });

  function handleSave() {
    const hkd = Number(draftHkdRate);
    const mop = Number(draftMopRate);
    if (!Number.isFinite(hkd) || hkd <= 0) {
      setValidationError(t('settings.currency.errors.rmbToHkdInvalid'));
      return;
    }
    if (!Number.isFinite(mop) || mop <= 0) {
      setValidationError(t('settings.currency.errors.rmbToMopInvalid'));
      return;
    }
    saveMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('settings.currency.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          {t('settings.currency.loadFailed', { message: (error as Error).message })}
        </CardContent>
      </Card>
    );
  }

  const currentDefault = data?.default ?? 'RMB';
  const currentHkd = Number(data?.rates['RMB->HKD'] ?? 0);
  const currentMop = Number(data?.rates['RMB->MOP'] ?? 0);
  // Derived on render so the admin sees the live MOP→HKD rate
  // that will be used by the next saved Quotation.
  const derivedMopToHkd =
    Number(draftMopRate) > 0 && Number(draftHkdRate) > 0
      ? Number(draftHkdRate) / Number(draftMopRate)
      : 0;
  const dirty =
    draftDefault !== currentDefault ||
    Number(draftHkdRate) !== currentHkd ||
    Number(draftMopRate) !== currentMop;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            <span>{t('settings.currency.title')}</span>
          </CardTitle>
          <CardDescription>
            {t('settings.currency.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="currency-default" className="text-sm font-medium">
                {t('settings.currency.default')}
              </label>
              <Select
                id="currency-default"
                className="w-full"
                value={draftDefault}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  setDraftDefault(e.target.value as 'RMB' | 'HKD' | 'MOP');
                  setValidationError(null);
                }}
                disabled={saveMutation.isPending}
              >
                <option value="RMB">{t('settings.currency.optionRmb')}</option>
                <option value="HKD">{t('settings.currency.optionHkd')}</option>
                <option value="MOP">{t('settings.currency.optionMop')}</option>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('settings.currency.defaultHelper')}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rate-rmb-hkd" className="text-sm font-medium">
                {t('settings.currency.rmbToHkdLabel')}
              </label>
              <Input
                id="rate-rmb-hkd"
                type="number"
                min={0}
                step="0.000001"
                value={draftHkdRate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setDraftHkdRate(e.target.value);
                  setValidationError(null);
                }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' && dirty) handleSave();
                }}
                disabled={saveMutation.isPending}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rate-rmb-mop" className="text-sm font-medium">
                {t('settings.currency.rmbToMopLabel')}
              </label>
              <Input
                id="rate-rmb-mop"
                type="number"
                min={0}
                step="0.000001"
                value={draftMopRate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setDraftMopRate(e.target.value);
                  setValidationError(null);
                }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' && dirty) handleSave();
                }}
                disabled={saveMutation.isPending}
                className="font-mono"
              />
            </div>
          </div>

          {/* Derived HKD/MOP rate — read-only. Shows what
              `hkdRateFor('MOP', cfg)` will return for the next
              saved Quotation. Static text so the admin doesn't
              have to do the math in their head. */}
          {derivedMopToHkd > 0 && (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <div className="text-muted-foreground">{t('settings.currency.derivedRates')}</div>
              <div className="font-mono mt-0.5">
                {t('settings.currency.derivedRateValue', { rate: derivedMopToHkd.toFixed(4) })}
                <span className="text-muted-foreground">
                  {t('settings.currency.derivedRateFormula', {
                    hkd: Number(draftHkdRate).toFixed(4),
                    mop: Number(draftMopRate).toFixed(4),
                  })}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending || !dirty}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              {saveMutation.isPending ? t('settings.currency.saving') : t('settings.currency.save')}
            </Button>
          </div>

          {validationError && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              {validationError}
            </p>
          )}

          <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
            <div>
              <span className="font-medium">{t('settings.currency.currentValue')}</span>{' '}
              <span className="font-mono">
                {t('settings.currency.currentValueText', {
                  default: currentDefault,
                  hkd: currentHkd,
                  mop: currentMop,
                })}
              </span>
            </div>
            {data?.updatedAt && (
              <div>
                <span className="font-medium">{t('settings.currency.lastUpdated')}</span>{' '}
                {formatDateTime(data.updatedAt)}
                {data.updatedBy && (
                  <>
                    {' '}
                    {t('common.by')} <span className="font-medium">{data.updatedBy.name}</span>
                    {data.updatedBy.email && (
                      <span className="text-muted-foreground/70"> ({data.updatedBy.email})</span>
                    )}
                  </>
                )}
              </div>
            )}
            {savedAt && (
              <div className="text-green-600 dark:text-green-400">
                {t('settings.currency.savedAt', { when: formatDateTime(savedAt) })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('settings.currency.auditTrailTitle')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('settings.currency.auditNote')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to={`/settings/audit?action=SYSTEM_CONFIG_UPDATED`}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <History className="h-3.5 w-3.5" />
            {t('settings.currency.auditTrailLink')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
