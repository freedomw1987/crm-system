import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Building2, Plus, X, Pencil, Briefcase, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { companiesApi, regionsApi, dealsApi, type Company, type Region } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DealDialog } from '@/pages/deals';
import { QuotationBuilder } from '@/components/quotation-builder';
import { formatDate } from '@/lib/utils';

export function CompaniesPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  // Day N: track which company card's "+ Deal" / "+ Quotation" button
  // was clicked so we can open the right modal with the right preset
  // (defaultCompanyId). A single object per dialog is enough because the
  // user can only open one of each at a time.
  const [dealDialog, setDealDialog] = useState<{ companyId: string } | null>(null);
  const [quotationDialog, setQuotationDialog] = useState<{ companyId: string } | null>(null);
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
  // Kanban stages (for the inline "+ Deal" dialog). We re-use the same
  // /deals/kanban query that pages/deals.tsx uses, so the stage list
  // stays in sync with the admin-configured pipeline. `stages` is the
  // shape DealDialog expects: { id, name, position, probability, color }.
  const { data: kanban } = useQuery({
    queryKey: ['deals-kanban'],
    queryFn: () => dealsApi.kanban(),
  });
  const kanbanStages = (kanban?.buckets ?? []).map((b) => b.stage);
  // Companies list — re-fetched here for the DealDialog's company dropdown.
  // (The page-level query filters by search/region; DealDialog needs the
  // full unfiltered list so the user can pick any company.)
  const { data: companiesAll = [] } = useQuery({
    queryKey: ['companies-all'],
    queryFn: () => companiesApi.list({ limit: 200 }),
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
            <CompanyCard
              key={c.id}
              company={c}
              onEdit={() => setEditing(c)}
              onNewDeal={() => setDealDialog({ companyId: c.id })}
              onNewQuotation={() => setQuotationDialog({ companyId: c.id })}
            />
          ))}
        </div>
      )}

      <CompanyFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => refetch()}
        regions={regions}
      />
      <CompanyFormDialog
        mode="edit"
        company={editing}
        open={editing !== null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        onSaved={() => refetch()}
        regions={regions}
      />
      {/* Inline modals (Day N): a "+ Deal" or "+ Quotation" button on
          each company card opens these pre-populated with the company.
          The user stays on the companies page after save — we just
          invalidate the relevant query keys so cross-page navigation
          shows the new row. */}
      {dealDialog && (
        <DealDialog
          open={true}
          onOpenChange={(v: boolean) => { if (!v) setDealDialog(null); }}
          stages={kanbanStages}
          companies={companiesAll}
          defaultCompanyId={dealDialog.companyId}
          onSaved={() => {
            setDealDialog(null);
            qc.invalidateQueries({ queryKey: ['deals-kanban'] });
            qc.invalidateQueries({ queryKey: ['companies'] });
          }}
        />
      )}
      {quotationDialog && (
        <Dialog open={true} onOpenChange={(v) => { if (!v) setQuotationDialog(null); }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>新增 Quotation</DialogTitle>
            </DialogHeader>
            <QuotationBuilder
              defaultCompanyId={quotationDialog.companyId}
              onSaved={() => {
                setQuotationDialog(null);
                qc.invalidateQueries({ queryKey: ['quotations'] });
                qc.invalidateQueries({ queryKey: ['deals-kanban'] });
                qc.invalidateQueries({ queryKey: ['companies'] });
              }}
              onCancel={() => setQuotationDialog(null)}
            />
          </DialogContent>
        </Dialog>
      )}
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

function CompanyCard({
  company,
  onEdit,
  onNewDeal,
  onNewQuotation,
}: {
  company: Company;
  onEdit: () => void;
  /** Open the inline "+ Deal" dialog pre-filled with this company. */
  onNewDeal?: () => void;
  /** Open the inline "+ Quotation" dialog pre-filled with this company. */
  onNewQuotation?: () => void;
}) {
  const region = company.region;
  const isOther = region?.code === 'OTHER';
  return (
    <div className="relative group">
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
      {/* Day N: "+ Deal" and "+ Quotation" affordances. They sit on the
          right edge of the card so the parent <Link> still works for the
          body of the card. `e.stopPropagation` prevents the card's
          onClick → navigate from firing. */}
      {(onNewDeal || onNewQuotation) && (
        <div className="absolute top-2 right-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {onNewDeal && (
            <button
              type="button"
              aria-label="新增 Deal"
              title="新增 Deal"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNewDeal(); }}
              className="h-7 w-7 rounded-md bg-background/80 backdrop-blur border border-input flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background"
            >
              <Briefcase className="h-3.5 w-3.5" />
            </button>
          )}
          {onNewQuotation && (
            <button
              type="button"
              aria-label="新增 Quotation"
              title="新增 Quotation"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNewQuotation(); }}
              className="h-7 w-7 rounded-md bg-background/80 backdrop-blur border border-input flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {/* Edit button — absolute-positioned over the card so it doesn't
          trigger the parent <Link>. stopPropagation ensures the card
          click doesn't navigate when the user means to edit. */}
      <button
        type="button"
        aria-label="編輯公司"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
        className="absolute top-2 right-2 h-7 w-7 rounded-md bg-background/80 backdrop-blur border border-input flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Shared form dialog for both creating and editing a company. Replaces
 * the old CreateCompanyDialog so we have a single source of truth for
 * the company form (was the root cause of "no edit in list" — the
 * create form was a standalone component that the list page never
 * threaded an edit prop through).
 *
 * Mode 'edit' requires a `company` prop (the row being edited); mode
 * 'create' ignores it. The form is initialised from the company in
 * edit mode and from empty strings in create mode. Region id is
 * pre-selected from company.regionId (with customRegion populated if
 * the chosen region is OTHER).
 */
export function CompanyFormDialog({
  mode,
  company,
  open,
  onOpenChange,
  onSaved,
  regions,
  defaultName,
}: {
  mode: 'create' | 'edit';
  company?: Company | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the saved company so the parent can chain actions
   *  (e.g. company-autocomplete wants the new id). In edit mode the
   *  argument is the updated company; in create mode it is the new one. */
  onSaved: (c?: Company) => void;
  regions: Region[];
  /** Pre-fill the name field on create (used by CompanyAutocomplete
   *  when the user typed a query that didn't match any company). */
  defaultName?: string;
}) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [website, setWebsite] = useState('');
  // Use the literal-union type so the cast in handleSubmit is a no-op
  // and TS narrows correctly through the <select> onChange.
  const [status, setStatus] = useState<Company['status']>('active');
  const [regionId, setRegionId] = useState<string>('');
  const [customRegion, setCustomRegion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-initialise the form whenever the dialog opens with a new target.
  // In edit mode, we seed from the company row; in create mode, we
  // start blank. We deliberately depend on the company id (not the
  // whole object) so editing one company and then opening another
  // doesn't show stale data while the new props are still settling.
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && company) {
      setName(company.name ?? '');
      setIndustry(company.industry ?? '');
      setEmail(company.email ?? '');
      setPhone(company.phone ?? '');
      setLegalName(company.legalName ?? '');
      setTaxId(company.taxId ?? '');
      setWebsite(company.website ?? '');
      setStatus(company.status ?? 'active');
      setRegionId(company.regionId ?? '');
      setCustomRegion(company.customRegion ?? '');
    } else {
      setName(''); setIndustry(''); setEmail(''); setPhone('');
      setLegalName(''); setTaxId(''); setWebsite(''); setStatus('active');
      setRegionId(''); setCustomRegion('');
    }
    setError(null);
  }, [open, mode, company?.id]);

  const selectedRegion = regions.find((r) => r.id === regionId);
  const isOther = selectedRegion?.code === 'OTHER';
  const isEdit = mode === 'edit';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name,
        industry: industry || undefined,
        email: email || undefined,
        phone: phone || undefined,
        legalName: legalName || undefined,
        taxId: taxId || undefined,
        website: website || undefined,
        status,
        // UI never offers a "clear region" affordance, so we coerce
        // empty string to undefined rather than null. Backend also
        // accepts null on update (used to clear) but the form
        // signature is stricter and prefers undefined.
        regionId: regionId || undefined,
        customRegion: isOther ? (customRegion || undefined) : undefined,
      };
      let saved: Company | undefined;
      if (isEdit && company) {
        saved = await companiesApi.update(company.id, payload);
      } else {
        saved = await companiesApi.create(payload);
      }
      onSaved(saved);
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
          <DialogTitle>{isEdit ? '編輯公司' : '新增公司'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">公司名稱 *</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="legalName">法定名稱</Label>
              <Input id="legalName" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="taxId">商業登記 / Tax ID</Label>
              <Input id="taxId" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </div>
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
            <Label htmlFor="website">網站</Label>
            <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          {isEdit && (
            <div>
              <Label htmlFor="status">狀態</Label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as Company['status'])}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blacklisted">Blacklisted</option>
              </select>
            </div>
          )}
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
              {submitting ? (isEdit ? '儲存中...' : '建立中...') : (isEdit ? '儲存' : '建立')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
