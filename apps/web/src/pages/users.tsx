import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, Plus, Users as UsersIcon, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, Label } from '@/components/ui/select';
import { usersApi, type UserSummary } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/utils';

export function UsersPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['users', { search, roleFilter }],
    queryFn: () => usersApi.list({ search: search || undefined, role: roleFilter || undefined, limit: 100 }),
  });
  const users = data?.items ?? [];

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersApi.update(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{t('user.title')}</h1>
          <p className="text-muted-foreground">{t('user.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('user.newUser')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('user.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">{t('user.filterAllRoles')}</option>
          <option value="ADMIN">{t('role.ADMIN')}</option>
          <option value="SALES">{t('role.SALES')}</option>
          <option value="VIEWER">{t('role.VIEWER')}</option>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('user.loading')}</p>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <UsersIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
            {t('user.empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-medium">{t('user.table.name')}</th>
                    <th className="px-4 py-3 font-medium">{t('user.table.role')}</th>
                    <th className="px-4 py-3 font-medium">{t('user.table.status')}</th>
                    <th className="px-4 py-3 font-medium">{t('user.table.lastLogin')}</th>
                    <th className="px-4 py-3 font-medium">{t('user.table.created')}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <Link to={`/users/${u.id}`} className="font-medium hover:underline">
                              {u.name}
                            </Link>
                            <div className="text-xs text-muted-foreground">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-4 py-3">
                        {u.isActive ? (
                          <Badge variant="success">{t('user.active')}</Badge>
                        ) : (
                          <Badge variant="secondary">{t('user.inactive')}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('user.neverLoggedIn')}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })}
                          disabled={toggleActive.isPending}
                        >
                          {u.isActive ? t('user.disable') : t('user.enable')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation();
  const map: Record<string, 'default' | 'info' | 'secondary'> = {
    ADMIN: 'default',
    SALES: 'info',
    VIEWER: 'secondary',
  };
  return <Badge variant={map[role] ?? 'default'}>{t(`role.${role}`, { defaultValue: role })}</Badge>;
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'SALES' | 'VIEWER'>('SALES');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      await usersApi.create({ email, name, role, password });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
      setEmail(''); setName(''); setRole('SALES'); setPassword('');
    } catch (e) {
      setError(t('user.dialog.errors.saveFailed', { message: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('user.dialog.createTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('user.dialog.email')}</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('user.dialog.name')}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">{t('user.dialog.role')}</Label>
            <Select id="role" value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'SALES' | 'VIEWER')}>
              <option value="SALES">{t('role.SALES')}</option>
              <option value="ADMIN">{t('role.ADMIN')}</option>
              <option value="VIEWER">{t('role.VIEWER')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">{t('user.dialog.password')}</Label>
            <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('user.dialog.passwordHint')}</p>
          </div>
          {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('user.dialog.cancel')}</Button>
          <Button onClick={submit} disabled={saving || !email || !name || password.length < 8}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('user.dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
