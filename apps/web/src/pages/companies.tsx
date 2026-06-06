import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Building2, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { companiesApi, regionsApi, type Company, type Region } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils';

export function CompaniesPage() {
  const [query, setQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const { data: companies = [], isLoading, refetch } = useQuery({
    queryKey: ['companies', { search: query, regionFilter }],
    queryFn: () => companiesApi.list({
      search: query || undefined,
      region: regionFilter || undefined,
      limit: 100,
    }),
  });
  // Day 9: the region list is now fetched from /api/regions so admins can
  // add new regions (Taiwan, Singapore, …) without a frontend code change.
  // We fall back to a hard-coded list of the 4 base regions while the
  // request is in flight so the filter row never shows empty pills.
  const { data: regions = BASE_REGIONS } = useQuery({
    queryKey: ['regions'],
    queryFn: () => regionsApi.list(),
    staleTime: 5 * 60_000, // catalogue rarely changes; 5 min is fine
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Companies</h1>
          <p className="text-muted-foreground">{companies.length} 間公司</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> 新增公司
        </Button>
      </div>

      {/* Search + region filter row */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋公司名 / legal name / email..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">地區:</span>
          <FilterPill
            active={!regionFilter}
            onClick={() => setRegionFilter('')}
            label="全部"
            flag=""
          />
          {regions.filter((r) => r.isActive).map((r) => (
            <FilterPill
              key={r.id}
              active={regionFilter === r.code}
              onClick={() => setRegionFilter(regionFilter === r.code ? '' : r.code)}
              label={r.name}
              flag={r.flag ?? ''}
            />
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">未有公司</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {companies.map((c) => (
            <CompanyCard key={c.id} company={c} />
          ))}
        </div>
      )}

      <CreateCompanyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => refetch()}
        regions={regions}
      />
    </div>
  );
}

const BASE_REGIONS: Region[] = [
  { id: 'reg_hk_seed', code: 'HK', name: '香港', flag: '🇭🇰', isActive: true, sortOrder: 1 },
  { id: 'reg_mo_seed', code: 'MO', name: '澳門', flag: '🇲🇴', isActive: true, sortOrder: 2 },
  { id: 'reg_cn_seed', code: 'CN', name: '中國', flag: '🇨🇳', isActive: true, sortOrder: 3 },
  { id: 'reg_other_seed', code: 'OTHER', name: '其他', flag: '🌏', isActive: true, sortOrder: 4 },
];

function FilterPill({ active, onClick, label, flag }: { active: boolean; onClick: () => void; label: string; flag: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background hover:bg-muted border-input'
      }`}
    >
      {flag && <span className="mr-1">{flag}</span>}
      {label}
    </button>
  );
}

function CompanyCard({ company }: { company: Company }) {
  const region = company.region;
  const isOther = region?.code === 'OTHER';
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
                {region && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {region.flag ? `${region.flag} ` : ''}
                    {isOther && company.customRegion ? company.customRegion : region.name}
                  </Badge>
                )}
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

function CreateCompanyDialog({
  open,
  onOpenChange,
  onCreated,
  regions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  regions: Region[];
}) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // Day 9: store the selected Region's *id* in state (we send `regionId`
  // to the backend; backend still accepts `region` as a code for back-compat).
  const [regionId, setRegionId] = useState<string>('');
  const [customRegion, setCustomRegion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRegion = regions.find((r) => r.id === regionId);
  const isOther = selectedRegion?.code === 'OTHER';

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
        // Backend accepts either `regionId` (cuid, preferred) or `region`
        // (Region.code). We pass regionId so future region renames don't
        // break the linkage.
        regionId: regionId || undefined,
        customRegion: isOther ? (customRegion || undefined) : undefined,
      });
      setName(''); setIndustry(''); setEmail(''); setPhone('');
      setRegionId(''); setCustomRegion('');
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
              {regions.filter((r) => r.isActive).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRegionId(r.id)}
                  className={`px-3 py-2 text-sm rounded border transition-colors text-left ${
                    regionId === r.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted'
                  }`}
                >
                  {r.flag ? `${r.flag} ` : ''}{r.name}
                </button>
              ))}
            </div>
          </div>
          {isOther && (
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
            <Button type="submit" disabled={submitting || !name || !regionId}>
              {submitting ? '建立中...' : '建立'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
