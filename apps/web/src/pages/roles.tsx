import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Shield, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { rolesApi, type Role } from '@/lib/api';
import { RoleDialog } from '@/components/role-dialog';

/**
 * RolesPage — RBAC role management.
 *
 * Create + Edit now flow through the unified `RoleDialog` component
 * (see apps/web/src/components/role-dialog.tsx). The previous in-file
 * `CreateRoleDialog` and `RoleEditor` were removed in 2026-06-06
 * because they duplicated the same field set and the same permission
 * matrix UI. A single `mode` prop (create | edit) covers both.
 */
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
  // Runtime-returned list of permission keys — used only for the
  // "X / Y 個權限" counter on each card. The matrix editor itself
  // lives inside RoleDialog.
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

      <RoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSaved={() => {
          // list query is already invalidated inside RoleDialog
          // (via rolesApi.create onSuccess). Nothing else to do here.
        }}
      />

      <RoleDialog
        open={editingRole !== null}
        onOpenChange={(v) => {
          if (!v) setEditingRole(null);
        }}
        mode="edit"
        role={editingRole}
        onSaved={() => {
          // list + per-role queries are already invalidated inside
          // RoleDialog. Close the dialog after the parent re-renders.
          setEditingRole(null);
        }}
      />
    </div>
  );
}
