import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, UserCog, ToggleLeft, ToggleRight } from 'lucide-react';
import { manDayRolesApi, type ManDayRole } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';

/**
 * Man-day Roles page (Day N) — admin-managed catalogue of pricing roles.
 *
 * Admins create / edit / delete roles like "Senior Engineer (¥2000 sell /
 * ¥1200 cost)". Sales reps never land here directly, but the Service form
 * and the Quotation GP calculation read this catalogue.
 *
 * Currency is locked to CNY on the backend — we deliberately do not show
 * a currency field in the form.
 */
export function ManDayRolesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ManDayRole | null>(null);
  const [creating, setCreating] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['man-day-roles'],
    queryFn: () => manDayRolesApi.list(),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => manDayRolesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['man-day-roles'] }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (r: ManDayRole) => manDayRolesApi.update(r.id, { isActive: !r.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['man-day-roles'] }),
  });

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <UserCog className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>此頁面只供管理員使用。Sales rep 請透過 Service 表單嘅下拉選單揀人天角色。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">人天結構</h1>
          <p className="text-muted-foreground">
            {roles.length} 個角色 · 報價用嘅人天單價同成本
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> 新增人天角色
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : roles.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <UserCog className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>仲未有人天角色。Click 「新增人天角色」加第一個 — 例如 "Senior Engineer" ¥2000/¥1200。</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {roles.map((r) => (
            <ManDayRoleCard
              key={r.id}
              role={r}
              onEdit={() => setEditing(r)}
              onDelete={() => {
                if (confirm(`確定刪除「${r.name}」?`)) removeMutation.mutate(r.id);
              }}
              onToggleActive={() => toggleActiveMutation.mutate(r)}
            />
          ))}
        </div>
      )}

      <ManDayRoleDialog
        mode="create"
        open={creating}
        onOpenChange={setCreating}
      />
      <ManDayRoleDialog
        mode="edit"
        role={editing}
        open={editing !== null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
      />
    </div>
  );
}

function ManDayRoleCard({
  role, onEdit, onDelete, onToggleActive,
}: {
  role: ManDayRole;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const margin = role.price - role.cost;
  const marginPct = role.price > 0 ? Math.round((margin / role.price) * 100) : 0;
  return (
    <Card className={role.isActive ? '' : 'opacity-60'}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{role.name}</h3>
              {!role.isActive && <Badge variant="secondary">Inactive</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              排序 {role.sortOrder} · 創建 {new Date(role.createdAt).toLocaleDateString('zh-HK')}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label="編輯">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon" variant="ghost" onClick={onDelete}
              aria-label="刪除"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">售價 (CNY)</div>
            <div className="font-semibold tabular-nums">¥{role.price.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">成本 (CNY)</div>
            <div className="font-semibold tabular-nums">¥{role.cost.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">毛利</div>
            <div className={`font-semibold tabular-nums ${marginPct >= 40 ? 'text-green-600' : marginPct >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
              {marginPct}%
            </div>
          </div>
        </div>

        <Button
          variant="ghost" size="sm"
          onClick={onToggleActive}
          className="w-full justify-start text-xs"
        >
          {role.isActive
            ? <><ToggleRight className="h-3.5 w-3.5 mr-1" /> 停用 (isActive)</>
            : <><ToggleLeft className="h-3.5 w-3.5 mr-1" /> 啟用 (isActive)</>}
        </Button>
      </CardContent>
    </Card>
  );
}

// (no extra helpers)

function ManDayRoleDialog({
  mode, role, open, onOpenChange,
}: {
  mode: 'create' | 'edit';
  role?: ManDayRole | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [price, setPrice] = useState<string>('');
  const [cost, setCost] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('0');
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-init whenever the dialog opens with a new target. Depends on
  // role?.id so editing one role and then opening another doesn't leak
  // the previous role's form state.
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && role) {
      setName(role.name);
      setPrice(String(role.price));
      setCost(String(role.cost));
      setSortOrder(String(role.sortOrder));
      setIsActive(role.isActive);
    } else if (mode === 'create') {
      setName('');
      setPrice('');
      setCost('');
      setSortOrder('0');
      setIsActive(true);
    }
    setError(null);
  }, [open, mode, role?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name,
        price: Number(price),
        cost: Number(cost || 0),
        sortOrder: Number(sortOrder || 0),
        isActive,
      };
      if (mode === 'edit' && role) {
        await manDayRolesApi.update(role.id, payload);
      } else {
        await manDayRolesApi.create(payload);
      }
      queryClient.invalidateQueries({ queryKey: ['man-day-roles'] });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? '編輯人天角色' : '新增人天角色'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">角色名稱 *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: Senior Engineer"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="price">售價 / 人天 (CNY) *</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="2000"
                required
              />
            </div>
            <div>
              <Label htmlFor="cost">成本 / 人天 (CNY)</Label>
              <Input
                id="cost"
                type="number"
                min="0"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="1200"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            幣種固定為人民幣。毛利 % 會自動計算。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="sortOrder">排序</Label>
              <Input
                id="sortOrder"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="isActive">狀態</Label>
              <select
                id="isActive"
                value={isActive ? 'active' : 'inactive'}
                onChange={(e) => setIsActive(e.target.value === 'active')}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="flex items-center justify-between bg-destructive/10 text-destructive text-sm p-2 rounded">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)}><X className="h-3 w-3" /></button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting || !name || price === ''}>
              {submitting ? '儲存中...' : (mode === 'edit' ? '儲存' : '建立')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
