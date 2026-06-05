import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Shield, Plus, Trash2, Loader2, Save, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/select';
import { rolesApi, type Role } from '@/lib/api';

/** Group all 27 permissions by resource prefix for the matrix editor. */
const PERMISSION_GROUPS: Array<{ prefix: string; label: string; description: string }> = [
  { prefix: 'user',   label: '用戶管理',  description: '管理系統用戶、角色、權限' },
  { prefix: 'audit',  label: '審計日誌',  description: '查看系統操作記錄' },
  { prefix: 'company',label: '公司',      description: '客戶/公司資料' },
  { prefix: 'contact',label: '聯絡人',    description: '客戶聯絡人' },
  { prefix: 'product',label: '產品',      description: '產品目錄' },
  { prefix: 'service',label: '服務',      description: '服務目錄 (SOW + 人天)' },
  { prefix: 'quotation', label: '報價單', description: '報價單管理' },
  { prefix: 'deal',   label: 'Deal',      description: '銷售 deal pipeline' },
  { prefix: 'role',   label: '角色',      description: '管理角色 + 權限矩陣' },
  { prefix: 'chat',   label: 'AI',        description: '使用 AI 助手' },
];

export function RolesPage() {
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => rolesApi.list(),
  });
  const roles = data?.items ?? [];

  const { data: permissionsList } = useQuery({
    queryKey: ['permissions'],
    queryFn: () => rolesApi.permissions(),
  });
  // Backend returns a string[] of permission keys. We rely on PERMISSIONS
  // (the enum from @crm/shared) for human-readable labels, but use the
  // runtime-returned list to know the exact set the API considers valid.
  const allPermissions: string[] = permissionsList ?? [];

  const removeRole = useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Role Management</h1>
          <p className="text-muted-foreground">管理系統角色與權限 (RBAC)</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          新增自訂角色
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : roles.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
            尚未建立任何角色
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => {
            const { _count, ...rest } = r;
            return (
              <Card key={r.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{r.displayName ?? r.name}</h3>
                        {r.isSystem && <Badge variant="info">System</Badge>}
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {r.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {_count?.permissions ?? 0} / {allPermissions.length} 個權限
                    {_count?.users !== undefined && ` · ${_count.users} 個用戶`}
                  </div>

                  <div className="flex gap-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditingRole(r)}
                    >
                      編輯權限
                    </Button>
                    {!r.isSystem && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm(`確定刪除角色「${r.displayName ?? r.name}」?`)) removeRole.mutate(r.id);
                        }}
                        disabled={removeRole.isPending}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editingRole && (
        <RoleEditor
          role={editingRole}
          allPermissions={allPermissions}
          onClose={() => setEditingRole(null)}
        />
      )}

      {createOpen && (
        <CreateRoleDialog
          allPermissions={allPermissions}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}

interface RoleEditorProps {
  role: Role;
  allPermissions: string[];
  onClose: () => void;
}
function RoleEditor({ role, allPermissions, onClose }: RoleEditorProps) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  // Backend's GET /roles/:id returns the full permissions array; the list
  // endpoint (GET /roles) does not. When editing, fetch the full role so we
  // can show its current permission set.
  const { data: fullRole } = useQuery({
    queryKey: ['role', role.id],
    queryFn: () => rolesApi.get(role.id),
  });
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(fullRole?.permissions ?? [])
  );
  useEffect(() => {
    if (fullRole?.permissions) setSelected(new Set(fullRole.permissions));
  }, [fullRole]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

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

  const updateMutation = useMutation({
    mutationFn: () => rolesApi.update(role.id, {
      name: name.trim(),
      description: description.trim(),
      permissions: Array.from(selected),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : '儲存失敗'),
  });

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError('請填角色名稱');
      return;
    }
    setSaving(true);
    try {
      await updateMutation.mutateAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl my-8">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">編輯角色</h2>
              {role.isSystem && <Badge variant="info">System</Badge>}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="name">角色名稱 *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={role.isSystem}
            />
            {role.isSystem && (
              <p className="text-xs text-muted-foreground">系統角色名稱不可修改</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc">描述</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-3 pt-2 border-t">
            <Label>權限 ({selected.size} / {allPermissions.length})</Label>

            {PERMISSION_GROUPS.map((g) => {
              const groupPerms = allPermissions.filter((p) => p.startsWith(g.prefix + ':'));
              if (groupPerms.length === 0) return null;
              const allOn = groupPerms.every((p) => selected.has(p));
              const someOn = groupPerms.some((p) => selected.has(p));
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
                    {groupPerms.map((p) => (
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

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              儲存
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface CreateRoleDialogProps {
  allPermissions: string[];
  onClose: () => void;
}
function CreateRoleDialog({ allPermissions, onClose }: CreateRoleDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  function toggle(perm: string) {
    const next = new Set(selected);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    setSelected(next);
  }

  async function create() {
    setError(null);
    if (!name.trim()) {
      setError('請填角色名稱');
      return;
    }
    setSaving(true);
    try {
      await rolesApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: Array.from(selected),
      });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '建立失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl my-8">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">新增自訂角色</h2>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="name">角色名稱 *</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senior Sales" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc">描述</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>權限 (0 個已選)</Label>
            <p className="text-xs text-muted-foreground">勾選該角色可以執行的操作</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto border rounded-lg p-3">
              {allPermissions.map((p) => (
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

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
            <Button onClick={create} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              建立
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
