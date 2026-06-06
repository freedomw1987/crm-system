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
import { Plus, Save, Loader2, X, Shield } from 'lucide-react';
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
 *  permission group here, mirror it there. */
const PERMISSION_GROUPS: Array<{ prefix: string; label: string; description: string }> = [
  { prefix: 'user',    label: '用戶管理',  description: '管理系統用戶、角色、權限' },
  { prefix: 'audit',   label: '審計日誌',  description: '查看系統操作記錄' },
  { prefix: 'company', label: '公司',      description: '客戶/公司資料' },
  { prefix: 'contact', label: '聯絡人',    description: '客戶聯絡人' },
  { prefix: 'product', label: '產品',      description: '產品目錄' },
  { prefix: 'service', label: '服務',      description: '服務目錄 (SOW + 人天)' },
  { prefix: 'quotation', label: '報價單', description: '報價單管理' },
  { prefix: 'deal',    label: 'Deal',      description: '銷售 deal pipeline' },
  { prefix: 'role',    label: '角色',      description: '管理角色 + 權限矩陣' },
  { prefix: 'chat',    label: 'AI',        description: '使用 AI 助手' },
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
    onError: (e) => setError(e instanceof Error ? e.message : '建立失敗'),
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
    onError: (e) => setError(e instanceof Error ? e.message : '儲存失敗'),
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
      setError('請填角色名稱');
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
            <DialogTitle>{isEdit ? '編輯角色' : '新增自訂角色'}</DialogTitle>
            {isEdit && role?.isSystem && <Badge variant="info">System</Badge>}
          </div>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="space-y-4"
        >
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="role-name">角色名稱 *</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isEdit ? undefined : 'e.g. Senior Sales'}
              disabled={isEdit && role?.isSystem}
              required
            />
            {isEdit && role?.isSystem && (
              <p className="text-xs text-muted-foreground">系統角色名稱不可修改</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role-desc">描述</Label>
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
              <Label>權限 ({selected.size} / {allPermissions.length})</Label>
            </div>
            {!isEdit && (
              <p className="text-xs text-muted-foreground">勾選該角色可以執行的操作</p>
            )}

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {visibleGroups.map((g) => {
                const allOn = g.perms.every((p) => selected.has(p));
                const someOn = g.perms.some((p) => selected.has(p));
                return (
                  <div key={g.prefix} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{g.label}</div>
                        <div className="text-xs text-muted-foreground">{g.description}</div>
                      </div>
                      <Button
                        type="button"
                        variant={allOn ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleGroup(g.prefix)}
                      >
                        {allOn ? '全選' : someOn ? '部分' : '全選'}
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
              取消
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : isEdit ? (
                <Save className="h-4 w-4 mr-1" />
              ) : (
                <Plus className="h-4 w-4 mr-1" />
              )}
              {isEdit ? '儲存' : '建立'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
