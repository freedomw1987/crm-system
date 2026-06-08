import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Mail, Phone, Globe, Plus, User, Star, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { companiesApi, quotationsApi, contactsApi, type Contact, type Region } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ActivityFeed } from '@/components/activity-feed';
import { AttachmentList } from '@/components/attachment-list';

// Day 9: CompanyDetailRegionMeta is the fallback used while /api/regions
// is still in flight (or if the request fails for offline browsing). It
// only needs to be large enough to render the company badge without
// flickering; the real catalogue comes from the API.
const CompanyDetailRegionMeta: Record<string, { flag: string; label: string }> = {
  HK: { flag: '🇭🇰', label: '香港' },
  MO: { flag: '🇲🇴', label: '澳門' },
  CN: { flag: '🇨🇳', label: '中國' },
  OTHER: { flag: '🌏', label: '其他' },
};

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  // Tab nav. The three CRM-entity tabs (Contacts / Deals / Quotation) are
  // promoted to top-level tabs in the order David asked for on Day N+2.
  // Activity and 附件 remain as additional tabs at the end so the
  // existing write paths (composer / flat attachment browse) stay
  // reachable. The tab state is local — deep-linking is not in scope.
  const [tab, setTab] = useState<'contacts' | 'deals' | 'quotation' | 'activity' | 'attachments'>('contacts');

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: () => companiesApi.get(id!),
    enabled: !!id,
  });
  const { data: quotations = [] } = useQuery({
    queryKey: ['quotations', { companyId: id }],
    queryFn: () => quotationsApi.list({ companyId: id, limit: 20 }),
    enabled: !!id,
  });
  const { data: deals = [] } = useQuery({
    queryKey: ['deals', { companyId: id }],
    queryFn: () =>
      // Reuse deals list filtered by company
      fetch(`/api/deals?companyId=${id}&limit=20`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('crm:token') ?? ''}` },
      }).then((r) => r.json()).then((r) => (Array.isArray(r) ? r : r.items ?? [])),
    enabled: !!id,
  });

  const deleteContact = useMutation({
    mutationFn: (contactId: string) => contactsApi.remove(contactId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company', id] }),
  });

  if (isLoading) return <p>載入中...</p>;
  if (!company) return <p>搵唔到呢間公司</p>;

  // Day 9: company.region is now a Region object (FK include). Fall back
  // to a hard-coded label for the four base regions when the object is
  // missing (older records created before the FK migration, or the rare
  // detail-page query that doesn't include the relation).
  const region = company.region;
  const regionCode = region?.code ?? 'HK';
  const regionMeta = CompanyDetailRegionMeta[regionCode] ?? CompanyDetailRegionMeta.OTHER;
  const regionLabel = regionCode === 'OTHER' && company.customRegion
    ? company.customRegion
    : region?.name ?? regionMeta.label;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/companies">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{company.name}</h1>
          {company.legalName && (
            <p className="text-sm text-muted-foreground">{company.legalName}</p>
          )}
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          {regionMeta.flag} {regionLabel}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardContent className="p-5 space-y-3">
            <div className="h-16 w-16 rounded bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <Building2 className="h-8 w-8" />
            </div>
            <div className="text-center">
              <Badge variant={company.status === 'active' ? 'success' : 'secondary'}>
                {company.status}
              </Badge>
            </div>
            {company.industry && (
              <div className="text-sm text-center text-muted-foreground">
                {company.industry}
              </div>
            )}
            <div className="space-y-2 pt-3 border-t text-sm">
              {company.email && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  <span className="truncate">{company.email}</span>
                </div>
              )}
              {company.phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {company.phone}
                </div>
              )}
              {company.website && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Globe className="h-3 w-3" />
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline truncate"
                  >
                    {company.website}
                  </a>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-4">
          {/* Tab nav. Stays inside the right-hand column so the company
              summary card on the left is always visible. */}
          <div className="flex items-center gap-1 border-b">
            {([
              { key: 'contacts',    label: '聯絡人', },
              { key: 'deals',       label: 'Deals', },
              { key: 'quotation',   label: 'Quotation', },
              { key: 'activity',    label: 'Activity', },
              { key: 'attachments', label: '附件', },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'contacts' && (
            <ContactsCard
              company={company}
              onAdd={() => setContactDialogOpen(true)}
              onDelete={(cid) => {
                if (confirm('刪除呢個聯絡人?')) deleteContact.mutate(cid);
              }}
            />
          )}

          {tab === 'deals' && (
            <DealsCard company={company} deals={deals} />
          )}

          {tab === 'quotation' && (
            <QuotationsCard company={company} quotations={quotations} />
          )}

          {tab === 'activity' && (
            /* Activity feed stays in its own tab. The composer and
               attachment upload still work the same way (they read
               companyId from the props). */
            <ActivityFeed companyId={id} title="公司 Activity" />
          )}

          {tab === 'attachments' && (
            /* Dedicated attachments list. Reads the same
               /companies/:id/attachments endpoint the activity composer
               uploads to, but flattens it into one scrollable list. */
            <AttachmentList companyId={id!} />
          )}
        </div>
      </div>

      <CreateContactDialog
        open={contactDialogOpen}
        onOpenChange={setContactDialogOpen}
        companyId={id!}
        onCreated={() => qc.invalidateQueries({ queryKey: ['company', id] })}
      />
    </div>
  );
}

// Day N+2: The original 資料 / Overview tab was split into three
// top-level tabs (Contacts / Deals / Quotation). Each is its own card
// component below so the page-level tab switch stays trivial and each
// card can be reasoned about (and tested) on its own. The "+ 新增"
// entry points stay in their card headers so they're reachable from
// anywhere in the company page.
type DealRow = { id: string; title: string; value: number; status: string; stage?: { name: string; color: string } };
type QuoteRow = { id: string; number: string; total: number; status: string; createdAt: string };

/** Contacts card — primary contact list with add/delete affordances. */
function ContactsCard({
  company,
  onAdd,
  onDelete,
}: {
  company: { id: string; name: string; contacts?: Contact[] };
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  const contacts = company.contacts ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>聯絡人 ({contacts.length})</CardTitle>
        <Button size="sm" onClick={onAdd}>
          <Plus className="h-3 w-3 mr-1" /> 新增聯絡人
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">仲未有聯絡人</p>
        ) : (
          <ul className="divide-y">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex items-center gap-3 p-4">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {contact.firstName} {contact.lastName}
                    </span>
                    {contact.isPrimary && (
                      <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                    )}
                    {contact.title && (
                      <span className="text-xs text-muted-foreground">· {contact.title}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {contact.email && <span>{contact.email}</span>}
                    {contact.phone && <span>{contact.phone}</span>}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onDelete(contact.id)}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Quotations card — list of quotation rows linking to detail page.
 *  The header always renders so the "+ 新增 Quotation" entry point is
 *  visible even when the list is empty. */
function QuotationsCard({
  company,
  quotations,
}: {
  company: { id: string };
  quotations: QuoteRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle>Quotations ({quotations.length})</CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to={`/quotations?companyId=${company.id}`}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 新增 Quotation
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {quotations.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">
            仲未有報價單 · 撳右上「新增 Quotation」開第一份
          </p>
        ) : (
          <ul className="divide-y">
            {quotations.map((q) => (
              <li key={q.id}>
                <Link
                  to={`/quotations/${q.id}`}
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <div className="font-mono text-sm">{q.number}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(q.createdAt)} · {q.status}
                    </div>
                  </div>
                  <div className="font-semibold tabular-nums">
                    {formatCurrency(q.total)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Deals card — list of deal rows. Same treatment as Quotations: the
 *  header always renders so "+ 新增 Deal" is always reachable. */
function DealsCard({
  company,
  deals,
}: {
  company: { id: string };
  deals: DealRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle>Deals ({deals.length})</CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to={`/deals?companyId=${company.id}`}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 新增 Deal
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {deals.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            暫未有 deal · 撳右上「新增 Deal」開第一個
          </p>
        ) : (
          <ul className="divide-y">
            {deals.map((d) => (
              <li key={d.id}>
                <Link to="/deals" className="flex items-center justify-between p-4 hover:bg-muted/50">
                  <div>
                    <div className="font-medium">{d.title}</div>
                    {d.stage && (
                      <div className="text-xs mt-0.5">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-white text-[10px]"
                          style={{ background: d.stage.color }}
                        >
                          {d.stage.name}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="font-semibold tabular-nums">
                    {formatCurrency(d.value)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CreateContactDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  onCreated: () => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await contactsApi.create({
        companyId,
        firstName,
        lastName,
        title: title || undefined,
        email: email || undefined,
        phone: phone || undefined,
        isPrimary,
      });
      setFirstName(''); setLastName(''); setTitle('');
      setEmail(''); setPhone(''); setIsPrimary(false);
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
          <DialogTitle>新增聯絡人</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="firstName">名 *</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="lastName">姓 *</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label htmlFor="title">職位</Label>
            <Input id="title" placeholder="e.g. CEO, Procurement Manager" value={title} onChange={(e) => setTitle(e.target.value)} />
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            <span>設為主要聯絡人 (Primary)</span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting || !firstName || !lastName}>
              {submitting ? '建立中...' : '建立'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// (unreachable stub to satisfy linter — not exported)
