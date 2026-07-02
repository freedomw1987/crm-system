/**
 * 2026-07-01 (US-MAINT-1) — System Settings → Maintenance Service tab.
 *
 * Single 0–100 percent input. The Quotation builder reads this on
 * mount and the "+ 維護費用" button computes the fee as
 * `current_draft_subtotal × rate / 100` and snapshots the result
 * into a SERVICE-typed line item. Re-clicking the button after
 * the user edits other line items does NOT auto-update an existing
 * maintenance-service line (the snapshot is locked at the moment of
 * the click) — to refresh the fee, the user removes the existing
 * line and clicks "+ 維護費用" again.
 *
 * Mirrors `SettingsTaxPage` (Day 14.7) so the admin UX is
 * consistent across global settings. The audit link uses
 * `action=SYSTEM_CONFIG_UPDATED` (no per-resource filter — the
 * audit log page filters by the action, and the resource id
 * `maintenance_fee_rate` is shown in each row's `resourceId`).
 *
 * 2026-07-01 rename: 維修費用 → 維護費用 + "Maintenance Fee" →
 * "Maintenance Service" (per user request). The internal
 * `maintenance_fee_rate` SystemConfig key + `/settings/maintenance-fee`
 * route + `MaintenanceFeeConfig` type + `settingsApi.getMaintenanceFee`
 * method name all keep their legacy identifiers to avoid breaking
 * the existing DB row / URL convention. Only the displayed strings
 * change.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Save, AlertTriangle, History, Wrench } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { settingsApi } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export function SettingsMaintenanceFeePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['settings', 'maintenance-fee'],
    queryFn: () => settingsApi.getMaintenanceFee(),
  });

  // Local edit buffer — bound to the input, committed on Save.
  const [draftRate, setDraftRate] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Seed the draft when the server value first loads. We only seed
  // from the server if the user hasn't typed anything yet (avoids
  // clobbering in-progress edits on every refetch).
  useEffect(() => {
    if (data && draftRate === '') {
      setDraftRate(String(data.rate));
    }
  }, [data, draftRate]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const n = Number(draftRate);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error(t('settings.maintenanceFee.errors.rateInvalid'));
      }
      return settingsApi.putMaintenanceFee({ rate: n });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'maintenance-fee'], updated);
      setDraftRate(String(updated.rate));
      setValidationError(null);
      setSavedAt(updated.updatedAt ?? new Date().toISOString());
    },
    onError: (e: Error) => {
      setValidationError(e.message);
    },
  });

  function handleSave() {
    const n = Number(draftRate);
    if (draftRate === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      setValidationError(t('settings.maintenanceFee.errors.rateInvalid'));
      return;
    }
    saveMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('settings.maintenanceFee.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          {t('settings.maintenanceFee.loadFailed', { message: (error as Error).message })}
        </CardContent>
      </Card>
    );
  }

  const currentRate = data?.rate ?? 0;
  const dirty = draftRate !== '' && Number(draftRate) !== currentRate;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            <span>{t('settings.maintenanceFee.title')}</span>
          </CardTitle>
          <CardDescription>
            {t('settings.maintenanceFee.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5 flex-1 max-w-xs">
              <label htmlFor="mf-rate" className="text-sm font-medium">
                {t('settings.maintenanceFee.rate')}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="mf-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={draftRate}
                  onChange={(e) => {
                    setDraftRate(e.target.value);
                    setValidationError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dirty) handleSave();
                  }}
                  disabled={saveMutation.isPending}
                  className="font-mono"
                />
                <span className="text-sm text-muted-foreground">%</span>
                <span className="text-xs text-muted-foreground/70">
                  {t('settings.maintenanceFee.rateMultiplier')}
                </span>
              </div>
            </div>
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
              {saveMutation.isPending ? t('settings.maintenanceFee.saving') : t('settings.maintenanceFee.save')}
            </Button>
          </div>

          {/* Worked example — updates live as the draft rate changes */}
          <div className="text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded space-y-0.5">
            <div className="font-medium text-foreground">{t('settings.maintenanceFee.example')}</div>
            <div>
              {t('settings.maintenanceFee.exampleLine', {
                rate: Number(draftRate || 0).toFixed(2),
                result: (100_000 * Number(draftRate || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }),
              })}
            </div>
          </div>

          {validationError && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              {validationError}
            </p>
          )}

          <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
            <div>
              <span className="font-medium">{t('settings.maintenanceFee.currentValue')}</span>{' '}
              <span className="font-mono">{currentRate}%</span>
            </div>
            {data?.updatedAt && (
              <div>
                <span className="font-medium">{t('settings.maintenanceFee.lastUpdated')}</span>{' '}
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
                {t('settings.maintenanceFee.savedAt', { when: formatDateTime(savedAt) })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('settings.maintenanceFee.auditTrailTitle')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('settings.maintenanceFee.auditNote')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to={`/settings/audit?action=SYSTEM_CONFIG_UPDATED`}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <History className="h-3.5 w-3.5" />
            {t('settings.maintenanceFee.auditTrailLink')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
