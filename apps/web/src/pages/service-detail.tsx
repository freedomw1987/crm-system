import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Trash2, Save } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { servicesApi, type ServiceManDay } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: service, isLoading } = useQuery({
    queryKey: ['service', id],
    queryFn: () => servicesApi.get(id!),
    enabled: !!id,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('HKD');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED' | 'DRAFT'>('ACTIVE');
  const [manDays, setManDays] = useState<ServiceManDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (service) {
      setName(service.name);
      setDescription(service.description ?? '');
      setCurrency(service.currency);
      setStatus(service.status ?? 'ACTIVE');
      // Belt-and-suspenders: the api layer normalises manDayLines → manDays
      // on response, so service.manDays is normally always an array. The
      // fallback keeps the component resilient if the response shape ever
      // regresses (e.g. an endpoint stops including the relation).
      setManDays((service.manDays ?? []).map((m) => ({ role: m.role, dayRate: m.dayRate, days: m.days })));
    }
  }, [service]);

  const total = manDays.reduce((sum, m) => sum + m.dayRate * m.days, 0);

  const updateMutation = useMutation({
    mutationFn: () =>
      servicesApi.update(id!, {
        name: name.trim(),
        description: description.trim(),
        currency,
        status,
        unitPrice: total,
        manDayLines: manDays,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service', id] });
      queryClient.invalidateQueries({ queryKey: ['services'] });
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : '儲存失敗'),
  });

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError('請填服務名稱');
      return;
    }
    setSaving(true);
    try {
      await updateMutation.mutateAsync();
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">載入中...</p>;
  }
  if (!service) {
    return <p className="text-sm text-destructive">找不到該服務</p>;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/services">
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Link>
        </Button>
        <h1 className="text-2xl md:text-3xl font-bold flex-1 truncate">{service.name}</h1>
        <Badge variant={status === 'ACTIVE' ? 'success' : status === 'ARCHIVED' ? 'secondary' : 'outline'}>
          {status === 'ACTIVE' ? 'Active' : status === 'ARCHIVED' ? 'Archived' : 'Draft'}
        </Badge>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">服務名稱 *</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sow">服務 SOW</Label>
            <Textarea
              id="sow"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
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
              <Label htmlFor="status">狀態</Label>
              <Select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'ARCHIVED' | 'DRAFT')}
              >
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
                <option value="DRAFT">Draft</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">人天結構 (SOW breakdown)</h2>
              <p className="text-xs text-muted-foreground mt-1">
                修改此處會即時更新服務總價;舊報價仍保留原 snapshot
              </p>
            </div>
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
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
              <div className="col-span-5">Role</div>
              <div className="col-span-3 text-right">Day rate</div>
              <div className="col-span-3 text-right">Days</div>
              <div className="col-span-1"></div>
            </div>
            {manDays.map((m, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-5"
                  placeholder="Role"
                  value={m.role}
                  onChange={(e) => {
                    const next = [...manDays];
                    next[idx] = { ...next[idx], role: e.target.value };
                    setManDays(next);
                  }}
                />
                <Input
                  className="col-span-3 text-right"
                  type="number"
                  value={m.dayRate || ''}
                  onChange={(e) => {
                    const next = [...manDays];
                    next[idx] = { ...next[idx], dayRate: Number(e.target.value) };
                    setManDays(next);
                  }}
                />
                <Input
                  className="col-span-3 text-right"
                  type="number"
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

          <div className="pt-3 border-t flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {manDays.length} role · {manDays.reduce((s, m) => s + m.days, 0)} days
            </span>
            <span className="text-lg font-bold">
              {formatCurrency(total, currency)}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate('/services')}>取消</Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          儲存
        </Button>
      </div>
    </div>
  );
}
