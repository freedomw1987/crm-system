import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Briefcase, Plus, Trash2, Power, PowerOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { servicesApi, type Service } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { QuickCreateServiceDialog } from '@/components/quick-create-service-dialog';

export function ServicesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['services', { search }],
    queryFn: () => servicesApi.list({ limit: 100 }),
  });
  // Backend may return { items, total } OR a bare array — normalise
  const items: Service[] = Array.isArray(data)
    ? (data as Service[])
    : ((data as { items?: Service[] } | undefined)?.items ?? []);

  const filtered = items.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleStatus = useMutation({
    mutationFn: (s: Service) =>
      servicesApi.update(s.id, { status: (s.status ?? 'ACTIVE') === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });

  const removeService = useMutation({
    mutationFn: (id: string) => servicesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{t('service.title')}</h1>
          <p className="text-muted-foreground">{t('service.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          {t('service.newService')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="search">{t('common.search')}</Label>
          <Input id="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('service.searchPlaceholder')} />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('service.loading')}</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Briefcase className="h-12 w-12 mx-auto mb-3 opacity-50" />
            {t('service.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Card key={s.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/services/${s.id}`}
                      className="font-semibold hover:underline block truncate"
                    >
                      {s.name}
                    </Link>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {s.description ?? '—'}
                    </p>
                  </div>
                  <Badge variant={s.status === 'ACTIVE' ? 'success' : s.status === 'ARCHIVED' ? 'secondary' : 'outline'}>
                    {s.status === 'ACTIVE' ? t('service.status.ACTIVE') : s.status === 'ARCHIVED' ? t('service.status.ARCHIVED') : t('service.status.DRAFT')}
                  </Badge>
                </div>

                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">{t('service.card.total')}</span>
                  <span className="font-semibold text-lg">
                    {formatCurrency(Number(s.unitPrice), s.currency)}
                  </span>
                </div>

                <div className="text-xs text-muted-foreground">
                  {t('service.card.manDayRoles', { count: s.manDays?.length ?? 0 })}
                  {' · '}
                  {t('service.card.daysTotal', { count: s.manDays?.reduce((sum, m) => sum + m.days, 0) ?? 0 })}
                </div>

                <div className="flex gap-2 pt-2 border-t">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link to={`/services/${s.id}`}>{t('service.card.edit')}</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleStatus.mutate(s)}
                    disabled={toggleStatus.isPending}
                  >
                    {s.status === 'ACTIVE' ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(t('service.deleteConfirm', { name: s.name }))) removeService.mutate(s.id);
                    }}
                    disabled={removeService.isPending}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {createOpen && (
        <QuickCreateServiceDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultName=""
          onCreated={() => {
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['services'] });
          }}
        />
      )}
    </div>
  );
}
