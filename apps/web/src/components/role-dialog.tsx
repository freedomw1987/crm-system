/**
 * RoleDialog — unified create + edit dialog for RBAC roles.
 *
 * Replaces the previous CreateRoleDialog + RoleEditor pair on
 * apps/web/src/pages/roles.tsx. Both share the same fields
 * (name, description, permissions matrix), so a single component
 * with a `mode` prop handles both.
 *
 * Mode-specific behaviour:
 *   - 'create': title "新增自訂角色", starts with an empty permission
 *               set. Newly created roles are never `isSystem` — that
 *               flag is set server-side when the role is part of the
 *               hardcoded seed (ADMIN / SALES / VIEWER).
 *   - 'edit':   title "編輯角色", prefills the role's current name +
 *               description + permissions. The backend's GET /roles/:id
 *               returns the full permissions array (the list endpoint
 *               does not), so we fetch the full role via
 *               rolesApi.get(role.id) on mount. If the role is a
 *               system role, the name input is disabled and a "System"
 *               badge is shown.
 *
 * Submit:
 *   - 'create': rolesApi.create({ name, description?, permissions })
 *   - 'edit':   rolesApi.update(role.id, { name, description, permissions })
 *
 * On success the roles list query is invalidated (via the parent's
 * onSaved callback or directly here). We use useMutation for the
 * submit + onSuccess invalidation pattern.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Loader2, Shield } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { rolesApi, type Role } from '@/lib/api';

/** Group all permissions by resource prefix for the matrix editor.
 *  Kept in sync with apps/web/src/pages/roles.tsx — if you add a
 *  permission group here, mirror it there.
 *
 *  2026-07-01 (US-PERM-GROUPS): added 7 missing groups that the
 *  PERMISSIONS matrix in @crm/shared exposes but the matrix UI
 *  was silently hiding. `settings:*` (system settings — tax /
 *  currency / maintenance fee / pipelines), `ai-config:*` (AI
 *  endpoint / model config), `man-day-role:*` (人天角色 catalogue),
 *  `region:*` (地區目錄), `activity:*` (Activity timeline), and
 *  `attachment:*` (file attachments). Without these, admins
 *  couldn't grant "settings:read" to a SALES-equivalent role
 *  (e.g. a "Settings Manager") because the row wasn't shown
 *  in the matrix — they'd hit 403 on settings pages with no
 *  way to grant the perm through the UI. */
const PERMISSION_GROUPS: Array<{ prefix: string; labelKey: string; descriptionKey: string }> = [
  { prefix: 'user',         labelKey: 'role.matrix.group.user.label',        descriptionKey: 'role.matrix.group.user.description' },
  { prefix: 'role',         labelKey: 'role.matrix.group.role.label',        descriptionKey: 'role.matrix.group.role.description' },
  { prefix: 'audit',        labelKey: 'role.matrix.group.audit.label',       descriptionKey: 'role.matrix.group.audit.description' },
  { prefix: 'settings',     labelKey: 'role.matrix.group.settings.label',    descriptionKey: 'role.matrix.group.settings.description' },
  { prefix: 'ai-config',    labelKey: 'role.matrix.group.aiConfig.label',    descriptionKey: 'role.matrix.group.aiConfig.description' },
  { prefix: 'man-day-role', labelKey: 'role.matrix.group.manDayRole.label',  descriptionKey: 'role.matrix.group.manDayRole.description' },
  { prefix: 'region',       labelKey: 'role.matrix.group.region.label',      descriptionKey: 'role.matrix.group.region.description' },
  { prefix: 'company',      labelKey: 'role.matrix.group.company.label',     descriptionKey: 'role.matrix.group.company.description' },
  { prefix: 'contact',      labelKey: 'role.matrix.group.contact.label',     descriptionKey: 'role.matrix.group.contact.description' },
  { prefix: 'product',      labelKey: 'role.matrix.group.product.label',     descriptionKey: 'role.matrix.group.product.description' },
  { prefix: 'service',      labelKey: 'role.matrix.group.service.label',     descriptionKey: 'role.matrix.group.service.description' },
  { prefix: 'quotation',    labelKey: 'role.matrix.group.quotation.label',   descriptionKey: 'role.matrix.group.quotation.description' },
  { prefix: 'deal',         labelKey: 'role.matrix.group.deal.label',        descriptionKey: 'role.matrix.group.deal.description' },
  { prefix: 'activity',     labelKey: 'role.matrix.group.activity.label',    descriptionKey: 'role.matrix.group.activity.description' },
  { prefix: 'attachment',   labelKey: 'role.matrix.group.attachment.label',  descriptionKey: 'role.matrix.group.attachment.description' },
  { prefix: 'chat',         labelKey: 'role.matrix.group.chat.label',        descriptionKey: 'role.matrix.group.chat.description' },
];

export interface RoleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: 'create' | 'edit';
  /** Required when mode === 'edit'. The role to prefill from. The list
   *  endpoint's `permissions` field is usually absent — the dialog
   *  will re-fetch the full role via rolesApi.get on mount. */
  role?: Role | null;
  /** Called after a successful save (create or update). The roles
   *  query is invalidated before this fires so the parent list is
   *  already up-to-date by the time you re-render. */
  onSaved: () => void;
}

export function RoleDialog({
  open, onOpenChange, mode, role, onSaved,
}: RoleDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit';

  // Permission catalogue (string[] of all valid permission keys).
  const { data: permissionsList } = useQuery({
    queryKey: ['permissions'],
    queryFn: () => rolesApi.permissions(),
    enabled: open,
  });
  const allPermissions: string[] = permissionsList ?? [];

  // In edit mode, fetch the full role so we have its permissions array
  // (the list endpoint doesn't include it). Keyed on the role id so it
  // refetches when the user opens the dialog for a different role.
  const { data: fullRole } = useQuery({
    queryKey: ['role', role?.id],
    queryFn: () => rolesApi.get(role!.id),
    enabled: open && isEdit && !!role?.id,
  });

  // Form state.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Prefill on open / when the role or its detail fetch changes.
  // - create: blank slate.
  // - edit:   use fullRole?.permissions if available, fall back to the
  //           role prop (which may be the partial list-shape).
  useEffect(() => {
    if (!open) return;
    if (isEdit && role) {
      setName(role.name);
      setDescription(role.description ?? '');
      const perms = fullRole?.permissions ?? (role as { permissions?: string[] }).permissions ?? [];
      setSelected(new Set(perms));
    } else {
      setName('');
      setDescription('');
      setSelected(new Set());
    }
    setError(null);
  }, [open, isEdit, role, fullRole]);

  const createMutation = useMutation({
    mutationFn: () => rolesApi.create({
      name: name.trim(),
      description: description.trim() || undefined,
      permissions: Array.from(selected),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => setError(t('role.dialog.errors.createFailed', { message: e instanceof Error ? e.message : '' })),
  });

  const updateMutation = useMutation({
    mutationFn: () => rolesApi.update(role!.id, {
      name: name.trim(),
      description: description.trim(),
      permissions: Array.from(selected),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['role', role!.id] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => setError(t('role.dialog.errors.saveFailed', { message: e instanceof Error ? e.message : '' })),
  });

  const submitting = createMutation.isPending || updateMutation.isPending;

  function toggle(perm: string) {
    const next = new Set(selected);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    setSelected(next);
  }

  function toggleGroup(prefix: string) {
    const groupPerms = allPermissions.filter((p) => p.startsWith(prefix + ':'));
    const allOn = groupPerms.every((p) => selected.has(p));
    const next = new Set(selected);
    for (const p of groupPerms) {
      if (allOn) next.delete(p);
      else next.add(p);
    }
    setSelected(next);
  }

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError(t('role.dialog.errors.nameRequired'));
      return;
    }
    if (isEdit) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  // Group permissions only for permission sets that actually have rows
  // in the catalogue — this mirrors the old editor's behaviour and
  // avoids rendering empty groups.
  const visibleGroups = useMemo(
    () => PERMISSION_GROUPS
      .map((g) => ({ ...g, perms: allPermissions.filter((p) => p.startsWith(g.prefix + ':')) }))
      .filter((g) => g.perms.length > 0),
    [allPermissions]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{isEdit ? t('role.dialog.editTitle') : t('role.dialog.createTitle')}</DialogTitle>
            {isEdit && role?.isSystem && <Badge variant="info">{t('role.systemBadge')}</Badge>}
          </div>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="space-y-4"
        >
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="role-name">{t('role.dialog.name')}</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isEdit ? undefined : t('role.dialog.namePlaceholder')}
              disabled={isEdit && role?.isSystem}
              required
            />
            {isEdit && role?.isSystem && (
              <p className="text-xs text-muted-foreground">{t('user.detail.systemRoleNameFixed')}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role-desc">{t('role.dialog.description')}</Label>
            <Textarea
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <Label>{t('role.dialog.matrix.selectedCount', { selected: selected.size, total: allPermissions.length })}</Label>
            </div>
            {!isEdit && (
              <p className="text-xs text-muted-foreground">{t('role.dialog.permissionsHint')}</p>
            )}

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {visibleGroups.map((g) => {
                const allOn = g.perms.every((p) => selected.has(p));
                const someOn = g.perms.some((p) => selected.has(p));
                return (
                  <div key={g.prefix} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{t(g.labelKey)}</div>
                        <div className="text-xs text-muted-foreground">{t(g.descriptionKey)}</div>
                      </div>
                      <Button
                        type="button"
                        variant={allOn ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleGroup(g.prefix)}
                      >
                        {allOn ? t('role.dialog.matrix.selectAll') : someOn ? t('role.dialog.matrix.someSelected') : t('role.dialog.matrix.selectAll')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-2">
                      {g.perms.map((p) => (
                        <label key={p} className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected.has(p)}
                            onChange={() => toggle(p)}
                            className="rounded"
                          />
                          <span className={selected.has(p) ? 'font-medium' : 'text-muted-foreground'}>
                            {p}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('role.dialog.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : isEdit ? (
                <Save className="h-4 w-4 mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              {isEdit ? t('role.dialog.save') : t('role.dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
