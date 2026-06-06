/**
 * QuickCreateServiceDialog — full Service creation form
 *
 * Used in two places:
 *   1. Quotation Builder autocomplete ("新增 Service「...」" action)
 *   2. Services page "新增服務" button (replaces the old local dialog)
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
 *       (`manDayRolesApi`). Picking a role auto-fills the dayRate from
 *       the role's `price`. The user can override the dayRate (and
 *       once they do, the row drops back to the free-form path so the
 *       override is preserved through save).
 *
 * On submit: servicesApi.create() is called directly.
 *
 * CRITICAL — backend POST /services body validator (apps/api/src/routes/service.ts
 * line 95-109) declares `manDayLines` (Prisma relation name). If we send
 * `manDays` the validator strips the unknown key and the relations are NOT
 * created → 502. We send `manDayLines: manDays` in the JSON payload (the
 * `Service` type in the frontend still uses `manDays`; only the wire key
 * changes here).
 *
 * The backend response also uses `manDayLines` (include: { manDayLines: true }).
 * We normalise it back to `manDays` before calling `onCreated` so the
 * downstream `Service`-typed consumers (e.g. applyService snapshot) read
 * the right field.
 *
 * Initial state: name pre-filled from `defaultName` prop; ONE empty
 * man-day row (role='', dayRate=0, days=0) — NOT a hardcoded example row.
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { useQuery } from '@tanstack/react-query';
import { servicesApi, manDayRolesApi, type Service, type ServiceManDay, type ManDayRole } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface QuickCreateServiceDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultName?: string;
  onCreated: (s: Service) => void;
}

interface ManDayRow {
  /** Free-text role label. Mirrors the backend ServiceManDay.role column. */
  role: string;
  /** Day rate (CNY for catalogue roles; whatever currency the user picks
   *  for free-form rows). Mirrors ServiceManDay.dayRate. */
  dayRate: number;
  days: number;
  /** When set, the row was picked from the ManDayRole catalogue. The
   *  backend uses this to snapshot the role's price/cost into the line. */
  manDayRoleId?: string | null;
  /** True when the user has manually edited the dayRate after the role
   *  was picked. When set, the row is sent as free-form (no
   *  manDayRoleId) so the override is preserved through save. */
  dayRateDirty?: boolean;
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

  // Active catalogue of man-day roles. `manDayRolesApi.list()` returns all
  // roles (the backend route does not support `?activeOnly=`), so we
  // filter client-side. The catalogue is small (< 50 rows in practice)
  // and shared with the Man-day Roles admin page, so a single fetch is
  // enough.
  const { data: allRoles = [] } = useQuery<ManDayRole[]>({
    queryKey: ['man-day-roles-active'],
    queryFn: () => manDayRolesApi.list(),
    select: (rows) => rows.filter((r) => r.isActive),
    staleTime: 5 * 60_000,
  });
  // Map of roleId → role for the auto-fill handler. Rebuilt on every
  // render because the catalogue is small and the change is O(n).
  const roleById = new Map(allRoles.map((r) => [r.id, r]));

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

  const total = manDays.reduce((sum, m) => sum + m.dayRate * m.days, 0);

  function updateRow(idx: number, patch: Partial<ManDayRow>) {
    setManDays((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function onPickRole(idx: number, roleId: string) {
    if (!roleId) {
      // User picked the empty option — clear the role binding but keep
      // whatever dayRate / days they already typed.
      updateRow(idx, { manDayRoleId: null, role: '', dayRateDirty: false });
      return;
    }
    const role = roleById.get(roleId);
    if (!role) {
      updateRow(idx, { manDayRoleId: roleId });
      return;
    }
    // Auto-fill the label + day rate from the catalogue. We do NOT mark
    // dayRateDirty — the user can still override the dayRate, which will
    // set the flag and switch the row to the free-form wire path.
    updateRow(idx, {
      manDayRoleId: role.id,
      role: role.name,
      dayRate: Number(role.price),
      dayRateDirty: false,
    });
  }

  function onChangeDayRate(idx: number, value: number) {
    // Mark the row dirty so the submit path drops the role binding and
    // sends the override as a free-form line.
    setManDays((prev) => prev.map((r, i) =>
      i === idx ? { ...r, dayRate: value, dayRateDirty: true } : r
    ));
  }

  function addRow() {
    setManDays((prev) => [...prev, { role: '', dayRate: 0, days: 0 }]);
  }

  function removeRow(idx: number) {
    setManDays((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError('請填服務名稱');
      return;
    }
    setSubmitting(true);
    try {
      // Backend's POST /services validator (`t.Object`) uses `manDayLines`
      // (Prisma relation name). The frontend `Service` type uses `manDays`;
      // we send the array under `manDayLines` so the validator accepts it
      // and the relations are created. `servicesApi.create` normalises the
      // response's `manDayLines` back to `manDays` for us.
      //
      // Man-day role binding: when a row has a manDayRoleId AND the user
      // has not overridden the day rate, we send `{ manDayRoleId, days }`
      // and the backend snapshots the role's current name/price/cost
      // (apps/api/src/routes/service.ts:36-69). When the user has
      // overridden the day rate, we drop the manDayRoleId and send the
      // free-form `{ role, dayRate, days }` so the override survives.
      //
      // The frontend `servicesApi.create` type is `{ role, dayRate, days }`
      // (added before the manDayRole feature), so we cast the array here
      // — the wire format matches the backend's snapshotManDayLine
      // contract exactly.
      const lines: Array<{ role?: string; dayRate?: number; manDayRoleId?: string; days: number }> = manDays.map((m) => {
        if (m.manDayRoleId && !m.dayRateDirty) {
          return { manDayRoleId: m.manDayRoleId, days: Number(m.days) || 0 };
        }
        return {
          role: m.role,
          dayRate: Number(m.dayRate) || 0,
          days: Number(m.days) || 0,
        };
      });
      const created = await servicesApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        status,
        currency,
        unitPrice: total,
        manDayLines: lines as unknown as Array<{ role: string; dayRate: number; days: number }>,
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
              {formatCurrency(total, currency)}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>人天結構</Label>
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-3 w-3 mr-1" /> 加一行
              </Button>
            </div>

            <div className="space-y-2">
              {manDays.map((m, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Select
                    className="col-span-5"
                    value={m.manDayRoleId ?? ''}
                    onChange={(e) => onPickRole(idx, e.target.value)}
                    title={m.role ? `已選: ${m.role}${m.dayRateDirty ? ' (day rate 已自訂)' : ''}` : undefined}
                  >
                    <option value="">— 自訂 role —</option>
                    {allRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · ¥{Number(r.price).toLocaleString()}/天
                      </option>
                    ))}
                  </Select>
                  <Input
                    className="col-span-3"
                    type="number"
                    placeholder="Day rate"
                    value={m.dayRate || ''}
                    onChange={(e) => onChangeDayRate(idx, Number(e.target.value))}
                  />
                  <Input
                    className="col-span-3"
                    type="number"
                    placeholder="Days"
                    value={m.days || ''}
                    onChange={(e) => updateRow(idx, { days: Number(e.target.value) })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="col-span-1"
                    onClick={() => removeRow(idx)}
                    disabled={manDays.length === 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

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
