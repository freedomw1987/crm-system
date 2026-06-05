import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Building2, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { companiesApi, type Company } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils';

const REGIONS: Array<{ value: 'HK' | 'MO' | 'CN' | 'OTHER'; label: string; flag: string }> = [
  { value: 'HK', label: '香港 Hong Kong', flag: '🇭🇰' },
  { value: 'MO', label: '澳門 Macau', flag: '🇲🇴' },
  { value: 'CN', label: '中國 China', flag: '🇨🇳' },
  { value: 'OTHER', label: '其他 (自由填寫)', flag: '🌏' },
];

export function CompaniesPage() {
  const [query, setQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const { data: companies = [], isLoading, refetch } = useQuery({
    queryKey: ['companies', { query, regionFilter }],
    queryFn: () => companiesApi.list({
      query: query || undefined,
      region: regionFilter || undefined,
      limit: 100,
    }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Companies</h1>
          <p className="text-muted-foreground">所有客戶公司 · 按地區分類 (HK / MO / CN / Other)</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> 新增公司
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋公司名 / email / industry..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {/* Region filter pills */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setRegionFilter('')}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              !regionFilter
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background hover:bg-muted'
            }`}
          >
            全部 ({companies.length})
          </button>
          {REGIONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setRegionFilter(r.value)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                regionFilter === r.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-muted'
              }`}
            >
              {r.flag} {r.value}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : companies.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            搵唔到任何公司
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((c) => (
            <CompanyCard key={c.id} company={c} />
          ))}
        </div>
      )}

      <CreateCompanyDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => refetch()} />
    </div>
  );
}

const REGION_LABELS: Record<string, { flag: string; label: string }> = {
  HK: { flag: '🇭🇰', label: '香港' },
  MO: { flag: '🇲🇴', label: '澳門' },
  CN: { flag: '🇨🇳', label: '中國' },
  OTHER: { flag: '🌏', label: '其他' },
};

function CompanyCard({ company }: { company: Company }) {
  const region = company.region ?? 'HK';
  const regionMeta = REGION_LABELS[region] ?? REGION_LABELS.OTHER;
  return (
    <Link to={`/companies/${company.id}`}>
      <Card className="hover:border-primary transition-colors h-full">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold truncate">{company.name}</h3>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {regionMeta.flag} {region === 'OTHER' && company.customRegion
                    ? company.customRegion
                    : regionMeta.label}
                </Badge>
              </div>
              {company.industry && (
                <p className="text-sm text-muted-foreground mt-0.5">{company.industry}</p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant={company.status === 'active' ? 'success' : 'secondary'}>
                  {company.status}
                </Badge>
                {company._count && (
                  <span className="text-xs text-muted-foreground">
                    {company._count.contacts} 聯絡人 ·{' '}
                    {company._count.quotations} 報價 ·{' '}
                    {company._count.deals} deals
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CreateCompanyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState<'HK' | 'MO' | 'CN' | 'OTHER'>('HK');
  const [customRegion, setCustomRegion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await companiesApi.create({
        name,
        industry: industry || undefined,
        email: email || undefined,
        phone: phone || undefined,
        region,
        customRegion: region === 'OTHER' ? (customRegion || undefined) : undefined,
      });
      // reset form
      setName(''); setIndustry(''); setEmail(''); setPhone('');
      setRegion('HK'); setCustomRegion('');
      onCreated();
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
          <DialogTitle>新增公司</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">公司名稱 *</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="industry">行業</Label>
            <Input id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">電話</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>地區 (Region) *</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {REGIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRegion(r.value)}
                  className={`px-3 py-2 text-sm rounded border transition-colors text-left ${
                    region === r.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted'
                  }`}
                >
                  {r.flag} {r.label}
                </button>
              ))}
            </div>
          </div>
          {region === 'OTHER' && (
            <div>
              <Label htmlFor="customRegion">其他地區 (自由填寫)</Label>
              <Input
                id="customRegion"
                placeholder="例如: Taiwan, Singapore, Japan..."
                value={customRegion}
                onChange={(e) => setCustomRegion(e.target.value)}
              />
            </div>
          )}
          {error && (
            <div className="flex items-center justify-between bg-destructive/10 text-destructive text-sm p-2 rounded">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)}><X className="h-3 w-3" /></button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting || !name}>
              {submitting ? '建立中...' : '建立'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
