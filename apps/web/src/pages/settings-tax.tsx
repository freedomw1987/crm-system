import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Save, AlertTriangle, History, Receipt } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { settingsApi } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

/**
 * Day 14.7 Step 7 — System Settings → Tax Rate tab.
 *
 * Single 0–100 percent input. The value is the **global default** applied
 * to NEW quotations (per Plan option A). Existing quotations keep their
 * per-row `taxRate` snapshot — editing this value does NOT retroactively
 * rewrite history. The Quotation builder (Step 9) will prefill from
 * `getTax()` on mount but the user can still override per-quote.
 *
 * Permission: `settings:update` is enforced server-side (backend 6a39ab6);
 * non-admins will see the current value (GET is auth-only) but the Save
 * button will be hidden + the PUT will 403 if they try.
 *
 * Audit: every successful PUT emits a `SYSTEM_CONFIG_UPDATED` row with
 * `metadata: { key, oldValue, newValue }`. The "View audit log" link
 * below filters to that resource id (`default_tax_rate`).
 */
export function SettingsTaxPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['settings', 'tax'],
    queryFn: () => settingsApi.getTax(),
  });

  // Local edit buffer — bound to the input, committed on Save.
  const [draftRate, setDraftRate] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Seed the draft when the server value first loads.
  useEffect(() => {
    if (data && draftRate === '') {
      setDraftRate(String(data.rate));
    }
  }, [data, draftRate]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const n = Number(draftRate);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error('稅率必須係 0–100 之間嘅數字');
      }
      return settingsApi.putTax({ rate: n });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'tax'], updated);
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
      setValidationError('稅率必須係 0–100 之間嘅數字');
      return;
    }
    saveMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tax config…
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          Failed to load tax rate: {(error as Error).message}
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
            <Receipt className="h-5 w-5" />
            <span>Default Tax Rate</span>
          </CardTitle>
          <CardDescription>
            設定新建報價 (Quotation) 嘅預設稅率(%)。已存在嘅報價會保留佢哋自己嘅
            tax rate 唔受影響;銷售同事建立新報價時可以逐張覆寫。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5 flex-1 max-w-xs">
              <label htmlFor="tax-rate" className="text-sm font-medium">
                稅率 (%)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="tax-rate"
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
              Save
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
              <span className="font-medium">當前生效值:</span>{' '}
              <span className="font-mono">{currentRate}%</span>
            </div>
            {data?.updatedAt && (
              <div>
                <span className="font-medium">最後更新:</span>{' '}
                {formatDateTime(data.updatedAt)}
                {data.updatedBy && (
                  <>
                    {' '}
                    by <span className="font-medium">{data.updatedBy.name}</span>
                    {data.updatedBy.email && (
                      <span className="text-muted-foreground/70"> ({data.updatedBy.email})</span>
                    )}
                  </>
                )}
              </div>
            )}
            {savedAt && (
              <div className="text-green-600 dark:text-green-400">
                ✓ Saved at {formatDateTime(savedAt)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            Audit Trail
          </CardTitle>
          <CardDescription className="text-xs">
            每次 save 會寫一條 <code className="font-mono">SYSTEM_CONFIG_UPDATED</code>{' '}
            audit event,記錄舊值同新值(12 個月 retention)。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to={`/settings/audit?action=SYSTEM_CONFIG_UPDATED`}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <History className="h-3.5 w-3.5" />
            View audit log for this setting →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
