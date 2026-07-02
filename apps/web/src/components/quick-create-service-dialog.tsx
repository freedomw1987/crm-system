/**
 * QuickCreateServiceDialog — full Service creation form
 *
 * Used in two places:
 *   1. Quotation Builder autocomplete ("新增 Service「...」" action)
 *   2. Services page "新增服務" button
 *
 * Day N: the man-day structure editor was extracted into the shared
 * `ManDayEditor` component. Both this dialog and the edit form on
 * service-detail.tsx mount the same component so the catalogue
 * pick-list, day-rate auto-fill, and wire-format conversion stay in
 * lock-step. See man-day-editor.tsx for the conversion contract.
 *
 * Form fields mirror the working pattern from `pages/services.tsx`:
 *   - name (required)
 *   - description (SOW textarea)
 *   - category (free-text, e.g. "Consulting")
 *   - status (ACTIVE / ARCHIVED / DRAFT, default ACTIVE)
 *   - currency (HKD/USD/CNY/EUR/GBP)
 *   - unit price is AUTO-CALCULATED from the man-day sum
 *   - man-day rows: add/remove role + dayRate + days
 *     - role is picked from the admin-managed ManDayRole catalogue
 *     - the day rate is auto-filled from the role's price
 *     - the user can override the day rate; the override is preserved
 *       through save by sending the row as free-form
 *
 * On submit: servicesApi.create() is called directly with the wire
 * format produced by ManDayEditor.toWireRows().
 *
 * Initial state: name pre-filled from `defaultName` prop; ONE empty
 * man-day row (role='', dayRate=0, days=0) — NOT a hardcoded example row.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { servicesApi, settingsApi, type Service } from '@/lib/api';
import { ManDayEditor, type ManDayRow, toWireRows } from './man-day-editor';

interface QuickCreateServiceDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultName?: string;
  onCreated: (s: Service) => void;
}

type ServiceStatus = 'ACTIVE' | 'ARCHIVED' | 'DRAFT';

export function QuickCreateServiceDialog({
  open, onOpenChange, defaultName = '', onCreated,
}: QuickCreateServiceDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<ServiceStatus>('ACTIVE');
  // P2 multi-currency (2026-06-29): pre-fill with the admin-set
  // default (typically RMB) instead of hard-coded HKD. Same React
  // Query key as /settings/currency so the cache is shared with the
  // Quotation Builder + the Currency settings page.
  const { data: currencyCfg } = useQuery({
    queryKey: ['settings', 'currency'],
    queryFn: () => settingsApi.getCurrency(),
    staleTime: 60_000,
  });
  const [userTouchedCurrency, setUserTouchedCurrency] = useState(false);
  const [currency, setCurrency] = useState<string>(currencyCfg?.default ?? 'RMB');
  const [manDays, setManDays] = useState<ManDayRow[]>([
    { role: '', dayRate: 0, days: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setDescription('');
      setCategory('');
      setStatus('ACTIVE');
      setCurrency(currencyCfg?.default ?? 'RMB');
      setUserTouchedCurrency(false);
      setManDays([{ role: '', dayRate: 0, days: 0 }]);
      setError(null);
    }
  }, [open, defaultName, currencyCfg?.default]);

  // If the user hasn't touched the picker AND the currency config
  // resolves after the dialog opens, sync the picker to the live
  // default. Mirrors userTouchedTax in QuotationBuilder.
  useEffect(() => {
    if (open && !userTouchedCurrency && currencyCfg?.default) {
      setCurrency(currencyCfg.default);
    }
  }, [open, userTouchedCurrency, currencyCfg?.default]);

  const total = manDays.reduce((sum, m) => sum + (Number(m.dayRate) || 0) * (Number(m.days) || 0), 0);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError(t('service.createDialog.errors.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await servicesApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        status,
        currency,
        unitPrice: total,
        manDayLines: toWireRows(manDays) as unknown as Array<{ role: string; dayRate: number; days: number }>,
      });
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('service.createDialog.errors.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('service.createDialog.title')}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="space-y-4"
        >
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="qcs-name">{t('service.createDialog.name')}</Label>
            <Input
              id="qcs-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('service.createDialog.namePlaceholder')}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qcs-sow">{t('service.createDialog.sow')}</Label>
            <Textarea
              id="qcs-sow"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('service.createDialog.sowPlaceholder')}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qcs-category">{t('service.createDialog.category')}</Label>
              <Input
                id="qcs-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t('service.createDialog.categoryPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qcs-status">{t('service.createDialog.status')}</Label>
              <Select
                id="qcs-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ServiceStatus)}
              >
                <option value="ACTIVE">{t('service.status.ACTIVE')}</option>
                <option value="ARCHIVED">{t('service.status.ARCHIVED')}</option>
                <option value="DRAFT">{t('service.status.DRAFT')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qcs-currency">{t('service.createDialog.currency')}</Label>
              <Select
                id="qcs-currency"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setUserTouchedCurrency(true);
                }}
              >
                {/* P2 multi-currency (2026-06-29): RMB/HKD/MOP are the
                    three system currencies (admin-configurable default
                    in /settings/currency). USD/EUR/GBP/legacy CNY left
                    in as fallbacks for services priced in a non-system
                    currency. */}
                <option value="RMB">{t('service.currency.RMB')}</option>
                <option value="HKD">{t('service.currency.HKD')}</option>
                <option value="MOP">{t('service.currency.MOP')}</option>
                <option value="USD">{t('service.currency.USD')}</option>
                <option value="CNY">{t('service.currency.CNY')}</option>
                <option value="EUR">{t('service.currency.EUR')}</option>
                <option value="GBP">{t('service.currency.GBP')}</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('service.createDialog.totalAuto')}</Label>
            <div className="px-3 py-2 rounded-md border bg-muted/30 text-sm font-semibold">
              {new Intl.NumberFormat('zh-HK', { style: 'currency', currency }).format(total)}
            </div>
          </div>

          <ManDayEditor
            rows={manDays}
            onChange={setManDays}
            currency={currency}
            label={t('service.manDayEditor.label')}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('service.createDialog.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('service.createDialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
