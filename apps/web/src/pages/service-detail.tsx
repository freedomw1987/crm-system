import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { servicesApi, settingsApi, type ServiceManDay } from '@/lib/api';
import { ManDayEditor, type ManDayRow, toWireRows } from '@/components/man-day-editor';
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
  // P2 multi-currency (2026-06-29): default to the system-set
  // default currency (e.g. RMB) instead of hard-coded HKD, so when
  // editing a legacy service that was created before the schema
  // default flipped, the picker shows the right starting point.
  // Falls back to 'RMB' if the API call hasn't resolved yet — matches
  // the schema default and the seeded currency_config.
  const { data: currencyCfg } = useQuery({
    queryKey: ['settings', 'currency'],
    queryFn: () => settingsApi.getCurrency(),
    staleTime: 60_000,
  });
  const [currency, setCurrency] = useState<string>(currencyCfg?.default ?? 'RMB');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED' | 'DRAFT'>('ACTIVE');
  const [manDays, setManDays] = useState<ManDayRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (service) {
      setName(service.name);
      setDescription(service.description ?? '');
      setCurrency(service.currency);
      setStatus(service.status ?? 'ACTIVE');
      // Day N: keep the catalogue binding on the row. The previous
      // implementation spread the row to a { role, dayRate, days } triple
      // which silently dropped `manDayRoleId` from the UI. After that
      // round-trip the row was sent as free-form on save and the
      // service lost its catalogue reference — even though the DB row
      // still had it. Mounting ManDayEditor + the same row shape as
      // the create dialog fixes the silent drop in one place.
      setManDays(
        (service.manDays ?? []).map((m) => ({
          id: m.id,
          role: m.role,
          dayRate: m.dayRate,
          days: m.days,
          manDayRoleId: m.manDayRoleId ?? null,
          costRate: m.costRate,
          sortOrder: m.sortOrder,
        }))
      );
    }
  }, [service]);

  const total = manDays.reduce((sum, m) => sum + (Number(m.dayRate) || 0) * (Number(m.days) || 0), 0);

  const updateMutation = useMutation({
    mutationFn: () =>
      servicesApi.update(id!, {
        name: name.trim(),
        description: description.trim(),
        currency,
        status,
        unitPrice: total,
        manDayLines: toWireRows(manDays) as unknown as ServiceManDay[],
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
                {/* P2 multi-currency (2026-06-29): RMB/HKD/MOP are the
                    three system-currencies (admin-configurable in
                    /settings/currency). USD/EUR/GBP left in as legacy
                    fallbacks for any service priced in a non-system
                    currency. */}
                <option value="RMB">人民幣 (RMB)</option>
                <option value="HKD">港幣 (HKD)</option>
                <option value="MOP">澳門幣 (MOP)</option>
                <option value="USD">美元 (USD)</option>
                <option value="CNY">CNY</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
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
        <CardContent className="p-6">
          <ManDayEditor
            rows={manDays}
            onChange={setManDays}
            currency={currency}
            label="人天結構 (SOW breakdown)"
            hint="修改此處會即時更新服務總價;舊報價仍保留原 snapshot"
          />
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
