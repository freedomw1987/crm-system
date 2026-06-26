import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, Plus, User, Calendar, DollarSign, Briefcase, Trash2, Edit2, Activity as ActivityIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { dealsApi, quotationsApi, type Quotation, type QuotationStatus, type Company } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { QuotationBuilder } from '@/components/quotation-builder';
import { DealActivityDialog } from '@/components/deal-activity-dialog';
import { DealDialog } from '@/pages/deals';

type Tab = 'quotations' | 'activity';

export function DealDetailPage() {
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
  const { data: dealActivities = [] } = useQuery({
    queryKey: ['deal-activities', id],
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

  if (isLoading) return <p className="p-6 text-muted-foreground">載入中...</p>;
  if (!deal) return <p className="p-6 text-muted-foreground">搵唔到呢個 deal</p>;

  const isOpen = deal.status === 'OPEN';
  const isWon = deal.status === 'WON';
  const isLost = deal.status === 'LOST';

  async function handleDelete() {
    // Re-check inside the closure — TS can't carry the post-null-check
    // narrowing from the render path into an async function body.
    if (!id || !deal) return;
    if (!window.confirm(`確定刪除 deal「${deal.title}」?此操作無法復原,相關 activities / quotations 會一齊 cascade。`)) return;
    setDeleteLoading(true);
    try {
      await dealsApi.remove(id);
      qc.invalidateQueries({ queryKey: ['deals-kanban'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['companies-all'] });
      navigate('/deals');
    } catch (err) {
      window.alert(`刪除失敗: ${(err as Error).message}`);
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
            {isOpen && <Badge variant="info">Open</Badge>}
            {isWon && <Badge variant="success">Won</Badge>}
            {isLost && <Badge variant="destructive">Lost</Badge>}
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
            新增報價
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
          >
            <Edit2 className="h-4 w-4 mr-2" />
            編輯
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleteLoading}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            刪除
          </Button>
        </div>
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetaTile
          icon={<DollarSign className="h-3.5 w-3.5" />}
          label="Deal Value"
          value={formatCurrency(Number(deal.value), deal.currency)}
        />
        {deal.expectedCloseDate && (
          <MetaTile
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="預計成交日"
            value={formatDate(deal.expectedCloseDate)}
          />
        )}
        {deal.closedAt && (
          <MetaTile
            icon={<Calendar className="h-3.5 w-3.5" />}
            label={isWon ? '成交日' : '結案日'}
            value={formatDate(deal.closedAt)}
          />
        )}
        <MetaTile
          icon={<FileText className="h-3.5 w-3.5" />}
          label="報價數量"
          value={`${(deal.quotations ?? []).length} 份`}
        />
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-1">
        <TabButton
          active={tab === 'quotations'}
          onClick={() => setTab('quotations')}
          count={(deal.quotations ?? []).length}
        >
          報價
        </TabButton>
        <TabButton
          active={tab === 'activity'}
          onClick={() => setTab('activity')}
          count={dealActivities.length}
        >
          Activity
        </TabButton>
      </div>

      {tab === 'quotations' && <QuotationsTab dealId={id!} dealCompanyId={deal.company?.id ?? ''} />}
      {tab === 'activity' && (
        <ActivityTab
          activities={dealActivities}
          dealId={id!}
          dealTitle={deal.title}
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
            <DialogTitle>為「{deal.title}」建立報價</DialogTitle>
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
  const { data: quotations = [], isLoading } = useQuery({
    queryKey: ['quotations', { dealId }],
    queryFn: () => quotationsApi.list({ dealId, limit: 50 }),
    enabled: !!dealId,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">載入中...</p>;

  if (quotations.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>呢個 deal 仲未有報價。</p>
          <p className="text-xs mt-1">撳上面「＋ 新增報價」整第一份。</p>
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
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
                {/* 2026-06-26: 銷售員 column on the deal-detail
                    Quotations tab. Mirrors the list page so users
                    scanning "all the quotations on this deal" can
                    see at a glance which salesperson owns each one
                    (important when reassigning deals mid-flight).
                    Falls back to the creator when salesRepId is
                    null. */}
                <th className="px-4 py-3 font-medium">銷售員</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Accepted</th>
                <th className="px-4 py-3"></th>
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
                    {formatCurrency(q.total)}
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
                      <Link to={`/quotations/${q.id}`}>查看</Link>
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
  activities, dealId, dealTitle, onAdd,
}: {
  activities: Array<{ id: string; type: string; content: string; createdAt: string; author?: { name: string } }>;
  dealId: string;
  dealTitle: string;
  onAdd: () => void;
}) {
  if (activities.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <ActivityIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>呢個 deal 仲未有 activity 記錄。</p>
          <Button size="sm" className="mt-3" onClick={onAdd}>
            <Plus className="h-4 w-4 mr-1" /> 新增 Activity
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> 新增 Activity
        </Button>
      </div>
      {activities.map((a) => (
        <Card key={a.id}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Badge variant="outline" className="text-[10px] py-0">{a.type}</Badge>
              {a.author?.name && <span>{a.author.name}</span>}
              <span>·</span>
              <span>{formatDateTime(a.createdAt)}</span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{a.content}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  const map: Record<QuotationStatus, 'default' | 'secondary' | 'info' | 'success' | 'warning' | 'destructive'> = {
    DRAFT: 'secondary',
    SENT: 'info',
    VIEWED: 'info',
    ACCEPTED: 'success',
    REJECTED: 'destructive',
    EXPIRED: 'warning',
    INVOICED: 'success',
  };
  return <Badge variant={map[status] ?? 'default'}>{status}</Badge>;
}
