/**
 * ManDayEditor — shared man-day structure editor for Services.
 *
 * Extracted from QuickCreateServiceDialog (Day N) and service-detail.tsx
 * (the pre-Day-N editor that didn't know about the ManDayRole catalogue).
 * Both pages now mount the same component, so the role-picker behaviour,
 * day-rate auto-fill, and wire-format conversion stay in sync.
 *
 * Behaviour:
 *   - Each row has a `<Select>` over the active ManDayRole catalogue.
 *     Picking a role auto-fills `role` (display name) and `dayRate` (the
 *     role's price) and stores `manDayRoleId` on the row.
 *   - The day-rate input is a free-text number; when the user edits it
 *     after a role was picked, we mark the row `dayRateDirty = true` so
 *     the submit path drops the role binding and sends the override as
 *     a free-form line (preserves the override through save).
 *   - Free-form rows (no `manDayRoleId`) send `{ role, dayRate, days }`.
 *   - Catalogue rows (with `manDayRoleId`, not dirty) send
 *     `{ manDayRoleId, days }` so the backend can re-snapshot the
 *     latest role price on save.
 *   - At least one row is always rendered (parent can render an
 *     empty-state placeholder instead if it really wants zero rows).
 *
 * Wire-format conversion lives in this file (`toWireRows`) so both
 * parents do exactly the same thing when they POST/PATCH. The shared
 * conversion is the entire reason this component exists — without it
 * the create vs. edit paths drift and one of them silently drops the
 * role binding on save.
 */

import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { manDayRolesApi, type ServiceManDay, type ManDayRole } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export interface ManDayRow extends ServiceManDay {
  /**
   * Catalogue binding. When set, the backend snapshots the role's
   * current name/price/cost into the ServiceManDay row. The frontend
   * uses the role's name/price locally for display so the user sees
   * the catalogue values while editing.
   */
  manDayRoleId?: string | null;
  /**
   * True when the user has manually edited the day rate after the role
   * was picked. When set, the wire-format converter drops the role
   * binding and sends the override as a free-form line.
   */
  dayRateDirty?: boolean;
}

export interface ManDayEditorProps {
  /** Current rows. Parent owns the state; this component is fully controlled. */
  rows: ManDayRow[];
  /** Called whenever a row changes / is added / removed. */
  onChange: (rows: ManDayRow[]) => void;
  /** Optional currency for the running total display. */
  currency?: string;
  /** Optional label above the table. Defaults to "人天結構". */
  label?: string;
  /** Optional caption under the label. */
  hint?: string;
}

/**
 * Convert the editor's internal `ManDayRow[]` shape to the wire format
 * expected by `servicesApi.create` / `servicesApi.update`.
 *
 * - Catalogue row, not dirty  → `{ manDayRoleId, days }`
 *   The backend snapshots the role's current name/price/cost.
 * - Catalogue row, dirty      → `{ role, dayRate, days }`
 *   The override survives through save.
 * - Free-form row (no role)   → `{ role, dayRate, days }`
 */
export function toWireRows(rows: ManDayRow[]): Array<{ role?: string; dayRate?: number; manDayRoleId?: string; days: number }> {
  return rows.map((m) => {
    if (m.manDayRoleId && !m.dayRateDirty) {
      return { manDayRoleId: m.manDayRoleId, days: Number(m.days) || 0 };
    }
    return {
      role: m.role,
      dayRate: Number(m.dayRate) || 0,
      days: Number(m.days) || 0,
    };
  });
}

export function ManDayEditor({
  rows,
  onChange,
  currency,
  label = '人天結構',
  hint,
}: ManDayEditorProps) {
  // Active catalogue. The backend route doesn't support ?activeOnly, so
  // we filter client-side. The catalogue is small (< 50 rows in practice)
  // and shared with the Man-day Roles admin page, so a single fetch with
  // a 5-minute staleTime is fine.
  const { data: allRoles = [] } = useQuery<ManDayRole[]>({
    queryKey: ['man-day-roles-active'],
    queryFn: () => manDayRolesApi.list(),
    select: (rs) => rs.filter((r) => r.isActive),
    staleTime: 5 * 60_000,
  });
  const roleById = useMemo(() => new Map(allRoles.map((r) => [r.id, r])), [allRoles]);

  function updateRow(idx: number, patch: Partial<ManDayRow>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function onPickRole(idx: number, roleId: string) {
    if (!roleId) {
      // Picked the empty option — clear the role binding but keep any
      // dayRate / days the user has already typed.
      updateRow(idx, { manDayRoleId: null, role: '', dayRateDirty: false });
      return;
    }
    const role = roleById.get(roleId);
    if (!role) {
      // Unknown role id (legacy data?) — keep the binding and let the
      // backend reject the save with a clear FK error.
      updateRow(idx, { manDayRoleId: roleId });
      return;
    }
    // Auto-fill the label + day rate from the catalogue. We do NOT
    // mark dayRateDirty — the user can still override dayRate, which
    // will set the flag and switch the row to the free-form wire path.
    updateRow(idx, {
      manDayRoleId: role.id,
      role: role.name,
      dayRate: Number(role.price),
      dayRateDirty: false,
    });
  }

  function onChangeDayRate(idx: number, value: number) {
    // Mark the row dirty so the wire-format converter drops the role
    // binding and sends the override as a free-form line.
    onChange(
      rows.map((r, i) => (i === idx ? { ...r, dayRate: value, dayRateDirty: true } : r))
    );
  }

  function addRow() {
    onChange([...rows, { role: '', dayRate: 0, days: 0 }]);
  }

  function removeRow(idx: number) {
    onChange(rows.length === 1 ? rows : rows.filter((_, i) => i !== idx));
  }

  const total = rows.reduce((sum, m) => sum + (Number(m.dayRate) || 0) * (Number(m.days) || 0), 0);
  const totalDays = rows.reduce((s, m) => s + (Number(m.days) || 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label>{label}</Label>
          {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3 w-3 mr-1" /> 加一行
        </Button>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
          <div className="col-span-5">Role</div>
          <div className="col-span-3 text-right">Day rate</div>
          <div className="col-span-3 text-right">Days</div>
          <div className="col-span-1"></div>
        </div>
        {rows.map((m, idx) => (
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
              className="col-span-3 text-right"
              type="number"
              placeholder="Day rate"
              value={m.dayRate || ''}
              onChange={(e) => onChangeDayRate(idx, Number(e.target.value))}
            />
            <Input
              className="col-span-3 text-right"
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
              disabled={rows.length === 1}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {rows.length} role · {totalDays} days
        </span>
        {currency && (
          <span className="text-lg font-bold">{formatCurrency(total, currency)}</span>
        )}
      </div>
    </div>
  );
}
