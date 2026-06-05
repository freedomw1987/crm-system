import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Briefcase, Plus, Trash2, Loader2, Power, PowerOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { servicesApi, type Service } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export function ServicesPage() {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['services', { search }],
    queryFn: () => servicesApi.list({ isActive: '', limit: 100 }),
  });
  // Backend may return { items, total } OR a bare array — normalise
  const items: Service[] = Array.isArray(data)
    ? (data as Service[])
    : ((data as { items?: Service[] } | undefined)?.items ?? []);

  const filtered = items.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleActive = useMutation({
    mutationFn: (s: Service) => servicesApi.update(s.id, { isActive: !s.isActive }),
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
          <h1 className="text-2xl md:text-3xl font-bold">Services</h1>
          <p className="text-muted-foreground">服務目錄,每個服務可設人天結構 (SOW) 與定價</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          新增服務
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="search">搜尋</Label>
          <Input id="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="服務名稱..." />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Briefcase className="h-12 w-12 mx-auto mb-3 opacity-50" />
            尚未建立任何服務
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
                  <Badge variant={s.isActive ? 'success' : 'secondary'}>
                    {s.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">總價</span>
                  <span className="font-semibold text-lg">
                    {formatCurrency(Number(s.unitPrice), s.currency)}
                  </span>
                </div>

                <div className="text-xs text-muted-foreground">
                  {s.manDays.length} 個 man-day role
                  {' · '}
                  {s.manDays.reduce((sum, m) => sum + m.days, 0)} days total
                </div>

                <div className="flex gap-2 pt-2 border-t">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link to={`/services/${s.id}`}>編輯</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActive.mutate(s)}
                    disabled={toggleActive.isPending}
                  >
                    {s.isActive ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(`確定刪除「${s.name}」?`)) removeService.mutate(s.id);
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
        <CreateServiceDialog
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['services'] });
          }}
        />
      )}
    </div>
  );
}

interface CreateServiceDialogProps {
  onClose: () => void;
  onSuccess: () => void;
}
function CreateServiceDialog({ onClose, onSuccess }: CreateServiceDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('HKD');
  const [unitPrice, setUnitPrice] = useState(0);
  const [manDays, setManDays] = useState<Array<{ role: string; dayRate: number; days: number }>>([
    { role: 'Senior Consultant', dayRate: 5000, days: 5 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = manDays.reduce((sum, m) => sum + m.dayRate * m.days, 0);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError('請填服務名稱');
      return;
    }
    setSubmitting(true);
    try {
      await servicesApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        currency,
        unitPrice: total, // initial price = sum of man-days
        manDays,
      });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : '建立失敗');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl my-8">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-bold">新增服務</h2>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="name">服務名稱 *</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Consulting Service" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sow">服務 SOW</Label>
            <Textarea
              id="sow"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Statement of Work — 詳細描述服務範圍..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="currency">貨幣</Label>
              <Select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option>HKD</option>
                <option>USD</option>
                <option>CNY</option>
                <option>EUR</option>
                <option>GBP</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>總價 (auto)</Label>
              <div className="px-3 py-2 rounded-md border bg-muted/30 text-sm font-semibold">
                {formatCurrency(total, currency)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>人天結構</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setManDays([...manDays, { role: '', dayRate: 0, days: 0 }])}
              >
                <Plus className="h-3 w-3 mr-1" />
                加一行
              </Button>
            </div>

            <div className="space-y-2">
              {manDays.map((m, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-5"
                    placeholder="Role (e.g. Senior Consultant)"
                    value={m.role}
                    onChange={(e) => {
                      const next = [...manDays];
                      next[idx] = { ...next[idx], role: e.target.value };
                      setManDays(next);
                    }}
                  />
                  <Input
                    className="col-span-3"
                    type="number"
                    placeholder="Day rate"
                    value={m.dayRate || ''}
                    onChange={(e) => {
                      const next = [...manDays];
                      next[idx] = { ...next[idx], dayRate: Number(e.target.value) };
                      setManDays(next);
                    }}
                  />
                  <Input
                    className="col-span-3"
                    type="number"
                    placeholder="Days"
                    value={m.days || ''}
                    onChange={(e) => {
                      const next = [...manDays];
                      next[idx] = { ...next[idx], days: Number(e.target.value) };
                      setManDays(next);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="col-span-1"
                    onClick={() => setManDays(manDays.filter((_, i) => i !== idx))}
                    disabled={manDays.length === 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              建立
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
