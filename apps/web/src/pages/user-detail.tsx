import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Trash2, KeyRound, Save, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { usersApi, type UserSummary } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/utils';

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();

  const { data: user, isLoading } = useQuery({
    queryKey: ['user', id],
    queryFn: () => usersApi.get(id!),
    enabled: !!id,
  });

  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<UserSummary['role'] | null>(null);
  const [isActive, setIsActive] = useState<boolean | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // Sync local edit state when user data loads
  if (user && name === null) {
    setName(user.name);
    setRole(user.role);
    setIsActive(user.isActive);
  }

  const update = useMutation({
    mutationFn: (data: Partial<Pick<UserSummary, 'name' | 'role' | 'isActive'>>) =>
      usersApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user', id] });
    },
  });

  const remove = useMutation({
    mutationFn: () => usersApi.remove(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      navigate('/users');
    },
  });

  const resetPw = useMutation({
    mutationFn: (pw: string) => usersApi.resetPassword(id!, pw),
    onSuccess: () => {
      setResetOpen(false);
      setNewPassword('');
    },
  });

  if (isLoading) return <p>載入中...</p>;
  if (!user) return <p>找不到這個用戶</p>;

  const isSelf = me?.id === user.id;
  const dirty = name !== user.name || role !== user.role || isActive !== user.isActive;

  function save() {
    const data: Partial<Pick<UserSummary, 'name' | 'role' | 'isActive'>> = {};
    if (name !== user!.name) data.name = name!;
    if (role !== user!.role) data.role = role!;
    if (isActive !== user!.isActive) data.isActive = isActive!;
    update.mutate(data);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/users">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{user.name}</h1>
          <p className="text-muted-foreground text-sm">{user.email}</p>
        </div>
        {isSelf && <Badge variant="info">你這個帳號</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本資料</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">姓名</Label>
              <Input id="name" value={name ?? ''} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">角色</Label>
              <Select id="role" value={role ?? ''} onChange={(e) => setRole(e.target.value as UserSummary['role'])}>
                <option value="ADMIN">管理員</option>
                <option value="SALES">銷售</option>
                <option value="VIEWER">檢視者</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="active">狀態</Label>
              <Select
                id="active"
                value={isActive ? 'true' : 'false'}
                onChange={(e) => setIsActive(e.target.value === 'true')}
                disabled={isSelf}
              >
                <option value="true">啟用</option>
                <option value="false">停用</option>
              </Select>
              {isSelf && <p className="text-xs text-muted-foreground">不可停用自己</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>帳號資訊</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p><span className="text-muted-foreground">建立:</span> {formatDateTime(user.createdAt)}</p>
          {user.lastLoginAt && (
            <p><span className="text-muted-foreground">最後登入:</span> {formatDateTime(user.lastLoginAt)}</p>
          )}
          {user.updatedAt && (
            <p><span className="text-muted-foreground">更新:</span> {formatDate(user.updatedAt)}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 justify-between">
        <div className="flex gap-2">
          <Button onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            儲存改動
          </Button>
          <Button variant="outline" onClick={() => setResetOpen(true)}>
            <KeyRound className="h-4 w-4 mr-2" />
            重設密碼
          </Button>
        </div>
        {!isSelf && (
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (window.confirm(`確定刪除 ${user.email}?`)) remove.mutate();
            }}
            disabled={remove.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            刪除用戶
          </Button>
        )}
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重設 {user.email} 的密碼</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="npw">新密碼 (至少 8 字)</Label>
            <Input id="npw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>取消</Button>
            <Button
              onClick={() => resetPw.mutate(newPassword)}
              disabled={newPassword.length < 8 || resetPw.isPending}
            >
              {resetPw.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              重設
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
