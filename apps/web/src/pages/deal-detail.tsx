import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, FileText, Plus, User, Calendar, DollarSign, Briefcase, Trash2, Edit2, Activity as ActivityIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { dealsApi, quotationsApi, type Quotation, type QuotationStatus, type Company, type Activity } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { QuotationBuilder } from '@/components/quotation-builder';
import { DealActivityDialog } from '@/components/deal-activity-dialog';
import { ActivityItem } from '@/components/activity-feed';
import { DealDialog } from '@/pages/deals';

type Tab = 'quotations' | 'activity';

export function DealDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('quotations');
  const [editOpen, setEditOpen] = useState(false);
  const [quotationBuilderOpen, setQuotationBuilderOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // GET /deals/:id returns the full deal with company / owner / stage /
  // pipeline + activities[30] + quotations[all, ordered]. The kanban
  // cache (deals-kanban / deals-by-company) stays consistent via the
  // invalidations on save / delete below.
  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => dealsApi.get(id!),
    enabled: !!id,
  });

  // The /deals/:id response only returns the most recent 30 activities;
  // the Activity tab wants more, so we re-fetch from the activity list
  // endpoint when the user switches to that tab. Lazy: don't fire the
  // query until the tab is actually opened.
  //
  // 2026-06-29: query key now starts with `['activities', ...]` (was
  // `['deal-activities', id]`) so the shared <ActivityItem> mutation
  // hooks (which call `qc.invalidateQueries({ queryKey: ['activities'] })`)
  // also refetch this view when the user edits / deletes / uploads from
  // inside the activity row.
  const { data: dealActivities = [] } = useQuery<Activity[]>({
    queryKey: ['activities', { dealId: id, list: 'deal-detail' }],
    queryFn: async () => {
      const r = await fetch(`/api/activities?dealId=${id}&limit=50`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('crm:token') ?? ''}` },
      });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : (j.items ?? []);
    },
    enabled: !!id && tab === 'activity',
  });

  if (isLoading) return <p className="p-6 text-muted-foreground">{t('deal.detail.loading')}</p>;
  if (!deal) return <p className="p-6 text-muted-foreground">{t('deal.detail.notFound')}</p>;

  const isOpen = deal.status === 'OPEN';
  const isWon = deal.status === 'WON';
  const isLost = deal.status === 'LOST';

  async function handleDelete() {
    // Re-check inside the closure — TS can't carry the post-null-check
    // narrowing from the render path into an async function body.
    if (!id || !deal) return;
    if (!window.confirm(t('deal.detail.deleteConfirm', { title: deal.title }))) return;
    setDeleteLoading(true);
    try {
      await dealsApi.remove(id);
      qc.invalidateQueries({ queryKey: ['deals-kanban'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['companies-all'] });
      navigate('/deals');
    } catch (err) {
      window.alert(t('deal.detail.deleteFailed', { message: (err as Error).message }));
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <Button asChild variant="ghost" size="icon">
          <Link to="/deals">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{deal.title}</h1>
            {deal.stage && (
              <Badge
                variant="outline"
                style={{ borderColor: deal.stage.color, color: deal.stage.color }}
              >
                {deal.stage.name}
              </Badge>
            )}
            {isOpen && <Badge variant="info">{t('status.deal.OPEN')}</Badge>}
            {isWon && <Badge variant="success">{t('status.deal.WON')}</Badge>}
            {isLost && <Badge variant="destructive">{t('status.deal.LOST')}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {deal.company ? (
              <>
                <Briefcase className="inline h-3 w-3 mr-1" />
                <Link
                  to={`/companies/${deal.company.id}`}
                  className="hover:underline"
                >
                  {deal.company.name}
                </Link>
              </>
            ) : '—'}
            {deal.owner && (
              <>
                {' · '}
                <User className="inline h-3 w-3 mr-1" />
                {deal.owner.name}
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={() => setQuotationBuilderOpen(true)}
            data-testid="deal-detail-new-quotation"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('deal.detail.newQuotation')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
          >
            <Edit2 className="h-4 w-4 mr-2" />
            {t('deal.detail.edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleteLoading}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('deal.detail.delete')}
          </Button>
        </div>
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetaTile
          icon={<DollarSign className="h-3.5 w-3.5" />}
          label={t('deal.detail.meta.dealValue')}
          value={formatCurrency(Number(deal.value), deal.currency)}
        />
        {deal.expectedCloseDate && (
          <MetaTile
            icon={<Calendar className="h-3.5 w-3.5" />}
            label={t('deal.detail.meta.expectedClose')}
            value={formatDate(deal.expectedCloseDate)}
          />
        )}
        {deal.closedAt && (
          <MetaTile
            icon={<Calendar className="h-3.5 w-3.5" />}
            label={isWon ? t('deal.detail.meta.closedAtWon') : t('deal.detail.meta.closedAt')}
            value={formatDate(deal.closedAt)}
          />
        )}
        <MetaTile
          icon={<FileText className="h-3.5 w-3.5" />}
          label={t('deal.detail.meta.quotationCount')}
          value={`${(deal.quotations ?? []).length}${t('deal.detail.meta.quotationCountSuffix')}`}
        />
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-1">
        <TabButton
          active={tab === 'quotations'}
          onClick={() => setTab('quotations')}
          count={(deal.quotations ?? []).length}
        >
          {t('deal.detail.tabs.quotations')}
        </TabButton>
        <TabButton
          active={tab === 'activity'}
          onClick={() => setTab('activity')}
          count={dealActivities.length}
        >
          {t('deal.detail.tabs.activity')}
        </TabButton>
      </div>

      {tab === 'quotations' && <QuotationsTab dealId={id!} dealCompanyId={deal.company?.id ?? ''} />}
      {tab === 'activity' && (
        <ActivityTab
          activities={dealActivities}
          onAdd={() => setActivityOpen(true)}
        />
      )}

      {/* Edit dialog — reuses DealDialog from deals.tsx. We pass a
          minimal Company (status: 'active' default) and the current
          stage. The deal-detail page intentionally doesn't fetch the
          full kanban buckets; stage changes still happen via the
          kanban drag-drop. */}
      <DealDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        companies={deal.company ? [{ id: deal.company.id, name: deal.company.name, status: 'active' } as Company] : []}
        stages={deal.stage ? [{ ...deal.stage, position: 0 }] : []}
        deal={deal}
        onSaved={() => {
          setEditOpen(false);
          qc.invalidateQueries({ queryKey: ['deal', id] });
          qc.invalidateQueries({ queryKey: ['deals-kanban'] });
        }}
      />

      {/* Quotation builder — pre-filled with this deal + its company. */}
      <Dialog open={quotationBuilderOpen} onOpenChange={setQuotationBuilderOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('deal.detail.quotationBuilderTitle', { title: deal.title })}</DialogTitle>
          </DialogHeader>
          <QuotationBuilder
            defaultCompanyId={deal.company?.id ?? ''}
            defaultDealId={id}
            onSaved={() => {
              setQuotationBuilderOpen(false);
              qc.invalidateQueries({ queryKey: ['deal', id] });
              qc.invalidateQueries({ queryKey: ['deals-kanban'] });
              qc.invalidateQueries({ queryKey: ['quotations'] });
            }}
            onCancel={() => setQuotationBuilderOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DealActivityDialog
        open={activityOpen}
        onOpenChange={setActivityOpen}
        dealId={id!}
        dealTitle={deal.title}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetaTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          {icon}
          {label}
        </div>
        <div className="text-lg font-semibold mt-0.5 tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function TabButton({
  active, onClick, count, children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
      {typeof count === 'number' && (
        <span className={`ml-1.5 text-xs ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
          ({count})
        </span>
      )}
    </button>
  );
}

function QuotationsTab({ dealId, dealCompanyId }: { dealId: string; dealCompanyId: string }) {
  // We re-fetch the full quotation list filtered by dealId. The detail
  // endpoint's `deal.quotations` only carries id/number/status/total;
  // the full row (title, items, total) is needed for the table.
  const { t } = useTranslation();
  const { data: quotations = [], isLoading } = useQuery({
    queryKey: ['quotations', { dealId }],
    queryFn: () => quotationsApi.list({ dealId, limit: 50 }),
    enabled: !!dealId,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('deal.detail.loading')}</p>;

  if (quotations.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>{t('deal.detail.quotationTabEmpty')}</p>
          <p className="text-xs mt-1">{t('deal.detail.quotationTabEmptyHint')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">{t('deal.detail.quotationTable.number')}</th>
                <th className="px-4 py-3 font-medium">{t('deal.detail.quotationTable.title')}</th>
                <th className="px-4 py-3 font-medium">{t('deal.detail.quotationTable.status')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('deal.detail.quotationTable.total')}</th>
                {/* 2026-06-26: 銷售員 column on the deal-detail
                    Quotations tab. Mirrors the list page so users
                    scanning "all the quotations on this deal" can
                    see at a glance which salesperson owns each one
                    (important when reassigning deals mid-flight).
                    Falls back to the creator when salesRepId is
                    null. */}
                <th className="px-4 py-3 font-medium">{t('deal.detail.quotationTable.salesRep')}</th>
                <th className="px-4 py-3 font-medium">{t('deal.detail.quotationTable.created')}</th>
                <th className="px-4 py-3 font-medium">{t('deal.detail.quotationTable.sent')}</th>
                <th className="px-4 py-3 font-medium">{t('deal.detail.quotationTable.accepted')}</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q: Quotation) => (
                <tr key={q.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{q.number}</td>
                  <td className="px-4 py-3 max-w-[200px] truncate">
                    {q.title ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <QuotationStatusBadge status={q.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(q.total, q.currency)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {q.salesRep?.name ?? q.createdBy?.name ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatDate(q.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {q.sentAt ? formatDate(q.sentAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {q.acceptedAt ? formatDate(q.acceptedAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/quotations/${q.id}`}>{t('deal.detail.quotationTable.view')}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityTab({
  activities, onAdd,
}: {
  activities: Activity[];
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  if (activities.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <ActivityIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>{t('deal.detail.activityEmpty')}</p>
          <Button size="sm" className="mt-3" onClick={onAdd}>
            <Plus className="h-4 w-4 mr-1" /> {t('deal.detail.newActivity')}
          </Button>
        </CardContent>
      </Card>
    );
  }
  // 2026-06-29: render each row via the shared <ActivityItem> so the
  // author-only edit / delete / attachment-CRUD affordances match the
  // company feed and the deals-page pipeline panel. The deal context
  // is implicit here (we're on /deals/:id), so we use the default
  // 'card' variant — each row reads as a distinct card.
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> {t('deal.detail.newActivity')}
        </Button>
      </div>
      {activities.map((a) => (
        <ActivityItem key={a.id} activity={a} />
      ))}
    </div>
  );
}

function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  const { t } = useTranslation();
  const map: Record<QuotationStatus, 'default' | 'secondary' | 'info' | 'success' | 'warning' | 'destructive'> = {
    DRAFT: 'secondary',
    SENT: 'info',
    VIEWED: 'info',
    ACCEPTED: 'success',
    REJECTED: 'destructive',
    EXPIRED: 'warning',
    INVOICED: 'success',
  };
  return <Badge variant={map[status] ?? 'default'}>{t(`status.quotation.${status}`)}</Badge>;
}