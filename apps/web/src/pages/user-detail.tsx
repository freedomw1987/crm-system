import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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

  if (isLoading) return <p>{t('user.detail.loading')}</p>;
  if (!user) return <p>{t('user.detail.notFound')}</p>;

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
        {isSelf && <Badge variant="info">{t('user.detail.currentAccount')}</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('user.detail.personalInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t('user.detail.name')}</Label>
              <Input id="name" value={name ?? ''} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">{t('user.detail.role')}</Label>
              <Select id="role" value={role ?? ''} onChange={(e) => setRole(e.target.value as UserSummary['role'])}>
                <option value="ADMIN">{t('role.ADMIN')}</option>
                <option value="SALES">{t('role.SALES')}</option>
                <option value="VIEWER">{t('role.VIEWER')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="active">{t('user.detail.status')}</Label>
              <Select
                id="active"
                value={isActive ? 'true' : 'false'}
                onChange={(e) => setIsActive(e.target.value === 'true')}
                disabled={isSelf}
              >
                <option value="true">{t('user.active')}</option>
                <option value="false">{t('user.inactive')}</option>
              </Select>
              {isSelf && <p className="text-xs text-muted-foreground">{t('user.detail.cannotDeactivateSelf')}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('user.detail.accountInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p><span className="text-muted-foreground">{t('user.detail.created')}:</span> {formatDateTime(user.createdAt)}</p>
          {user.lastLoginAt && (
            <p><span className="text-muted-foreground">{t('user.detail.lastLogin')}:</span> {formatDateTime(user.lastLoginAt)}</p>
          )}
          {user.updatedAt && (
            <p><span className="text-muted-foreground">{t('user.detail.updated')}:</span> {formatDate(user.updatedAt)}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 justify-between">
        <div className="flex gap-2">
          <Button onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {t('user.detail.saveChanges')}
          </Button>
          <Button variant="outline" onClick={() => setResetOpen(true)}>
            <KeyRound className="h-4 w-4 mr-2" />
            {t('user.detail.resetPassword')}
          </Button>
        </div>
        {!isSelf && (
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (window.confirm(t('user.detail.deleteConfirm', { email: user.email }))) remove.mutate();
            }}
            disabled={remove.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('user.detail.deleteUser')}
          </Button>
        )}
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('user.detail.resetDialog.title', { email: user.email })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="npw">{t('user.detail.resetDialog.label')}</Label>
            <Input id="npw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>{t('user.detail.resetDialog.cancel')}</Button>
            <Button
              onClick={() => resetPw.mutate(newPassword)}
              disabled={newPassword.length < 8 || resetPw.isPending}
            >
              {resetPw.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('user.detail.resetDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
