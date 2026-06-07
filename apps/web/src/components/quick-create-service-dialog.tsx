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
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { servicesApi, type Service } from '@/lib/api';
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
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<ServiceStatus>('ACTIVE');
  const [currency, setCurrency] = useState('HKD');
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
      setCurrency('HKD');
      setManDays([{ role: '', dayRate: 0, days: 0 }]);
      setError(null);
    }
  }, [open, defaultName]);

  const total = manDays.reduce((sum, m) => sum + (Number(m.dayRate) || 0) * (Number(m.days) || 0), 0);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError('請填服務名稱');
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
      setError(e instanceof Error ? e.message : '建立失敗');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新增服務</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="space-y-4"
        >
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="qcs-name">服務名稱 *</Label>
            <Input
              id="qcs-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Consulting Service"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qcs-sow">服務 SOW</Label>
            <Textarea
              id="qcs-sow"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Statement of Work — 詳細描述服務範圍..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qcs-category">分類</Label>
              <Input
                id="qcs-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Consulting"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qcs-status">狀態</Label>
              <Select
                id="qcs-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ServiceStatus)}
              >
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
                <option value="DRAFT">Draft</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qcs-currency">貨幣</Label>
              <Select
                id="qcs-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option>HKD</option>
                <option>USD</option>
                <option>CNY</option>
                <option>EUR</option>
                <option>GBP</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>總價 (auto)</Label>
            <div className="px-3 py-2 rounded-md border bg-muted/30 text-sm font-semibold">
              {new Intl.NumberFormat('zh-HK', { style: 'currency', currency }).format(total)}
            </div>
          </div>

          <ManDayEditor
            rows={manDays}
            onChange={setManDays}
            currency={currency}
            label="人天結構"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              建立
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
