import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { KanbanSquare, Plus, GripVertical, X, Edit2, FileText, StickyNote, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { dealsApi, companiesApi, settingsApi, type KanbanData, type Deal, type Company } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { CompanyAutocomplete } from '@/components/company-autocomplete';
import { MultiCompanyAutocomplete } from '@/components/multi-company-autocomplete';
import { MultiUserAutocomplete } from '@/components/multi-user-autocomplete';
import { UserAutocomplete } from '@/components/user-autocomplete';
import { QuotationBuilder } from '@/components/quotation-builder';
import { DealActivityDialog } from '@/components/deal-activity-dialog';
import { DealsActivityPanel } from '@/components/deals-activity-panel';

export function DealsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const presetCompanyId = searchParams.get('companyId') ?? undefined;
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  // Day N: when a deal-card's "+ 報價" button is clicked, store the
  // deal in this state so the inline <QuotationBuilder> modal opens
  // pre-filled with deal + company. No navigation, no page change.
  const [quotationFor, setQuotationFor] = useState<Deal | null>(null);
  // Day N+1: same pattern for "＋ Activity". We keep the deal object so
  // the dialog title can show "{dealTitle} · 新增 Activity".
  const [activityFor, setActivityFor] = useState<Deal | null>(null);
  // 2026-06-09: multi-select Company + sales-rep (ownerId) filters.
  // Empty array = no filter. The kanban query is keyed on these so
  // changing them triggers a fresh server fetch.
  const [filterCompanyIds, setFilterCompanyIds] = useState<string[]>([]);
  const [filterOwnerIds, setFilterOwnerIds] = useState<string[]>([]);
  const { data: kanban, isLoading } = useQuery({
    queryKey: ['deals-kanban', {
      companyIds: filterCompanyIds,
      ownerIds: filterOwnerIds,
    }],
    queryFn: () => dealsApi.kanban({
      companyIds: filterCompanyIds.length ? filterCompanyIds : undefined,
      ownerIds: filterOwnerIds.length ? filterOwnerIds : undefined,
    }),
  });
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-all'],
    queryFn: () => companiesApi.list({ limit: 200 }),
  });

  // Auto-open the create dialog when navigated in with ?companyId=... so a
  // "新增 Deal" button on a company-detail page can land here with the
  // company pre-filled. Strip the param on close so a refresh doesn't
  // re-open the dialog.
  useEffect(() => {
    if (presetCompanyId) setCreateOpen(true);
  }, [presetCompanyId]);

  function closeCreate() {
    setCreateOpen(false);
    if (presetCompanyId) {
      const next = new URLSearchParams(searchParams);
      next.delete('companyId');
      setSearchParams(next, { replace: true });
    }
  }

  // Move-deal mutation. Once a Company filter is active the kanban
  // queryKey becomes ['deals-kanban', { companyId: 'X' }] — but this
  // mutation handler doesn't know which filter is in play. We do an
  // optimistic update on the *currently cached* kanban (whichever
  // filter is active) and invalidate the prefix, so the next render
  // refetches the right view.
  const moveStage = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      dealsApi.moveStage(dealId, stageId),
    onMutate: async ({ dealId, stageId }) => {
      // Cancel all kanban queries (any filter active) so an in-flight
      // request doesn't clobber our optimistic snapshot.
      await qc.cancelQueries({ queryKey: ['deals-kanban'] });
      // Snapshot + optimistically patch every cached kanban variant.
      // The user's currently-visible variant will be the one they see
      // the change on; the others will be re-fetched on next access.
      const entries = qc.getQueriesData<KanbanData>({ queryKey: ['deals-kanban'] });
      const snapshots: Array<readonly [QueryKey, KanbanData | undefined]> = entries.map(
        ([key, data]) => {
          if (!data) return [key, undefined] as const;
          const next: KanbanData = {
            ...data,
            buckets: data.buckets.map((b) => ({ ...b, deals: [...b.deals] })),
          };
          let movedDeal: Deal | undefined;
          for (const b of next.buckets) {
            const idx = b.deals.findIndex((d) => d.id === dealId);
            if (idx !== -1) {
              movedDeal = b.deals[idx];
              b.deals.splice(idx, 1);
              break;
            }
          }
          const targetBucket = next.buckets.find((b) => b.stage.id === stageId);
          if (targetBucket && movedDeal) {
            targetBucket.deals.unshift({ ...movedDeal, stage: targetBucket.stage });
          }
          qc.setQueryData(key, next);
          return [key, data] as const;
        }
      );
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      // Roll back all snapshots we took. For variants that had no
      // data originally, remove the (now-polluted) cache entry so the
      // next read refetches from the server.
      ctx?.snapshots.forEach(([key, data]) => {
        if (data === undefined) qc.removeQueries({ queryKey: key });
        else qc.setQueryData(key, data);
      });
    },
    onSettled: () => {
      // Refetch whichever kanban variant is currently active.
      qc.invalidateQueries({ queryKey: ['deals-kanban'] });
    },
  });

  // Day N+1 (P1-X): delete a deal from the Kanban card. The Trash icon
  // sits at the visual right edge of the card's top-right hover group
  // (per 2026-06-29 user request — destructive action furthest from
  // the eye). We invalidate every kanban variant (regardless of active
  // filter) so any cached view stays in sync.
  const deleteDeal = useMutation({
    mutationFn: (dealId: string) => dealsApi.remove(dealId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals-kanban'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['companies-all'] });
    },
  });

  // Compute pipeline stats
  const stats = useMemo(() => {
    if (!kanban) return { totalValue: 0, weightedValue: 0, openCount: 0 };
    let totalValue = 0;
    let weightedValue = 0;
    let openCount = 0;
    for (const b of kanban.buckets) {
      for (const d of b.deals) {
        // Prisma returns Decimal as a string; coerce explicitly to avoid
        // string-concat accumulation when summing across the kanban.
        const v = Number(d.value);
        totalValue += v;
        weightedValue += v * (b.stage.probability / 100);
        if (d.status === 'OPEN') openCount += 1;
      }
    }
    return { totalValue, weightedValue, openCount };
  }, [kanban]);

  // P2 multi-currency (2026-06-29): stats display amounts in the
  // admin-configured system default (typically RMB). Falls back to
  // 'RMB' until the API call resolves, matching the schema default.
  // Caveat: this sums deals across mixed currencies (since Deal
  // doesn't snapshot exchangeRateToHKD — only Quotation does). For
  // v1 we accept that the sum is unitless; converting each deal to
  // HKD-equivalent would require a Deal.currency rate, which is a
  // bigger schema change. Sales teams reading the stat should
  // interpret it as "rough magnitude" not "exact total".
  const { data: currencyCfg } = useQuery({
    queryKey: ['settings', 'currency'],
    queryFn: () => settingsApi.getCurrency(),
    staleTime: 60_000,
  });
  const systemCurrency = currencyCfg?.default ?? 'RMB';

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Deals Pipeline</h1>
          <p className="text-muted-foreground">
            銷售 pipeline · {kanban?.pipeline.name ?? 'Default Sales Pipeline'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-sm hidden md:block">
            <div className="text-muted-foreground text-xs">Open / Total</div>
            <div className="font-semibold">{stats.openCount} deals · {formatCurrency(stats.totalValue, systemCurrency)}</div>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> 新增 Deal
          </Button>
        </div>
      </div>

      {/* 2026-06-09: Multi-select Company + sales-rep filters for the
          kanban. Sits above the stats so the page opens with the most
          common question answered ("where are we with Acme?") before
          the user has to look at numbers. The clear-all button resets
          both filters. The "X deals" hint counts after both filters. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1 max-w-md">
          <MultiCompanyAutocomplete
            value={filterCompanyIds}
            onChange={setFilterCompanyIds}
            companies={companies}
            label="Company"
            placeholder="搜尋公司..."
          />
        </div>
        <div className="min-w-[260px] flex-1 max-w-md">
          <MultiUserAutocomplete
            value={filterOwnerIds}
            onChange={setFilterOwnerIds}
            label="銷售員"
            placeholder="搜尋銷售員..."
          />
        </div>
        {(filterCompanyIds.length > 0 || filterOwnerIds.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilterCompanyIds([]); setFilterOwnerIds([]); }}
            className="text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" /> 清除 filter
          </Button>
        )}
        {(filterCompanyIds.length > 0 || filterOwnerIds.length > 0) && kanban && (
          <div className="text-sm text-muted-foreground pb-2 w-full">
            顯示 {kanban.buckets.reduce((sum, b) => sum + b.deals.length, 0)} 個 deal
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open Deals" value={`${stats.openCount}`} />
        <StatCard label="Total Value" value={formatCurrency(stats.totalValue, systemCurrency)} />
        <StatCard label="Weighted (by prob.)" value={formatCurrency(stats.weightedValue, systemCurrency)} highlight />
        <StatCard label="Stages" value={`${kanban?.buckets.length ?? 0}`} />
      </div>

      {isLoading || !kanban ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : (
        <>
          {/* Kanban board first — sales reps see the funnel layout as
              the primary view. The recent-activity panel moves BELOW
              the board (was ABOVE on Day N+1) so the eye scans the
              pipeline top-to-bottom, and the activity feed is what
              you read at the end of the page (closer to "wrap up /
              weekly review" mental mode). */}
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 min-w-max">
              {kanban.buckets.map((bucket) => (
                <KanbanColumn
                  key={bucket.stage.id}
                  stage={bucket.stage}
                  deals={bucket.deals}
                  onDrop={(dealId) => moveStage.mutate({ dealId, stageId: bucket.stage.id })}
                  isMoving={moveStage.isPending}
                  systemCurrency={systemCurrency}
                  onEdit={(deal) => setEditing(deal)}
                  onDelete={(deal) => {
                    if (confirm(`確定刪除 deal「${deal.title}」?此操作無法復原,相關 activities / quotations 會一齊 cascade。`)) {
                      deleteDeal.mutate(deal.id);
                    }
                  }}
                  onNewQuotation={(deal) => setQuotationFor(deal)}
                  onNewActivity={(deal) => setActivityFor(deal)}
                />
              ))}
            </div>
          </div>
          <DealsActivityPanel />
        </>
      )}

      <DealDialog
        open={createOpen}
        onOpenChange={(v) => (v ? setCreateOpen(true) : closeCreate())}
        companies={companies}
        stages={kanban?.buckets.map((b) => b.stage) ?? []}
        defaultCompanyId={presetCompanyId ?? companies[0]?.id}
        onSaved={() => qc.invalidateQueries({ queryKey: ['deals-kanban'] })}
      />
      <DealDialog
        deal={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        companies={companies}
        stages={kanban?.buckets.map((b) => b.stage) ?? []}
        onSaved={() => {
          setEditing(null);
          qc.invalidateQueries({ queryKey: ['deals-kanban'] });
        }}
      />
      {/* Day N: inline QuotationBuilder modal triggered from a deal card.
          Pre-fills with `defaultDealId` + the deal's company so the user
          doesn't have to re-pick either. The builder's onSaved also bumps
          the kanban cache (deal._count.quotations) so the card's
          "X 份報價 · ＋" counter updates immediately. */}
      <Dialog open={quotationFor !== null} onOpenChange={(v) => { if (!v) setQuotationFor(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              為「{quotationFor?.title ?? ''}」建立報價
            </DialogTitle>
          </DialogHeader>
          {quotationFor && (
            <QuotationBuilder
              defaultCompanyId={quotationFor.company?.id ?? ''}
              defaultDealId={quotationFor.id}
              onSaved={() => {
                setQuotationFor(null);
                qc.invalidateQueries({ queryKey: ['deals-kanban'] });
                qc.invalidateQueries({ queryKey: ['quotations'] });
              }}
              onCancel={() => setQuotationFor(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {/* Day N+1: same inline-modal pattern for "新增 Activity". Mounts
          the DealActivityDialog pre-filled with the deal id. The dialog
          itself owns the composer / file picker / submit logic; the page
          just needs to track which deal (if any) is being logged. */}
      <DealActivityDialog
        open={activityFor !== null}
        onOpenChange={(v) => { if (!v) setActivityFor(null); }}
        dealId={activityFor?.id ?? ''}
        dealTitle={activityFor?.title}
      />
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? 'bg-primary/5 border-primary/30' : ''}>
      <div className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-lg font-bold mt-0.5 ${highlight ? 'text-primary' : ''}`}>{value}</div>
      </div>
    </Card>
  );
}

function KanbanColumn({
  stage,
  deals,
  onDrop,
  isMoving,
  systemCurrency,
  onEdit,
  onDelete,
  onNewQuotation,
  onNewActivity,
}: {
  stage: { id: string; name: string; probability: number; color: string };
  deals: Deal[];
  onDrop: (dealId: string) => void;
  isMoving: boolean;
  /** P2 multi-currency (2026-06-29): admin-set system default currency
   *  (RMB/HKD/MOP) — used to format the per-stage value subtotal. */
  systemCurrency: string;
  onEdit: (deal: Deal) => void;
  /** Day N+1 (P1-X): confirm-then-delete this deal from the card.
   *  Cascades to activities / quotations via Prisma onDelete: Cascade. */
  onDelete?: (deal: Deal) => void;
  /** Day N: open QuotationBuilder inline-modal pre-filled with this deal.
   *  Replaces the previous navigate('/quotations?dealId=...') flow so the
   *  user never leaves the Kanban board to draft a quote. */
  onNewQuotation?: (deal: Deal) => void;
  /** Day N+1: open DealActivityDialog pre-filled with this deal. */
  onNewActivity?: (deal: Deal) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  // Prisma returns Decimal as a string; coerce each value so we don't
  // accidentally concatenate two strings and produce a trillion-HK$ total.
  const total = deals.reduce((s, d) => s + Number(d.value), 0);

  return (
    <div
      className={`w-72 shrink-0 rounded-lg border bg-muted/30 transition-colors ${
        dragOver ? 'border-primary bg-primary/5' : 'border-border'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const dealId = e.dataTransfer.getData('text/deal-id');
        if (dealId) onDrop(dealId);
      }}
    >
      {/* Column header */}
      <div
        className="px-3 py-2.5 rounded-t-lg flex items-center justify-between"
        style={{ background: `${stage.color}1A` }} // ~10% opacity
      >
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
          <h3 className="font-semibold text-sm">{stage.name}</h3>
          <Badge variant="secondary" className="text-xs">{deals.length}</Badge>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums font-medium">
          {formatCurrency(total, systemCurrency)}
        </div>
      </div>

      {/* Cards */}
      <div className="p-2 space-y-2 min-h-[200px] max-h-[70vh] overflow-y-auto scrollbar-thin">
        {deals.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8 select-none pointer-events-none">
            拖 deal 落呢度
          </p>
        ) : (
          deals.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              disabled={isMoving}
              onEdit={onEdit}
              onDelete={onDelete}
              onNewQuotation={onNewQuotation}
              onNewActivity={onNewActivity}
            />
          ))
        )}
      </div>
      <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t">
        Probability: {stage.probability}%
      </div>
    </div>
  );
}

function DealCard({
  deal,
  disabled,
  onEdit,
  onDelete,
  onNewQuotation,
  onNewActivity,
}: {
  deal: Deal;
  disabled: boolean;
  onEdit: (d: Deal) => void;
  /** Day N+1 (P1-X): confirm-then-delete this deal. The card's outer
   *  onClick → navigate handler means the Trash button MUST
   *  e.stopPropagation() or every click on the icon navigates away. */
  onDelete?: (d: Deal) => void;
  /** Day N: open QuotationBuilder inline-modal pre-filled with this deal.
   *  Still used when the deal has NO quotations yet (the empty-state CTA).
   *  When the deal HAS quotations, the count chip navigates to the deal
   *  detail page so the user can see the existing ones — see onClick. */
  onNewQuotation?: (d: Deal) => void;
  /** Day N+1: open DealActivityDialog pre-filled with this deal. */
  onNewActivity?: (d: Deal) => void;
}) {
  // Track drag state so a click on the card body doesn't navigate while
  // the user is mid-drag.
  const [dragging, setDragging] = useState(false);
  const navigate = useNavigate();
  const quoteCount = deal._count?.quotations ?? 0;
  return (
    <div
      draggable={!disabled}
      // Day 9: previously we only set `dragging` state to suppress the click
      // during drag, but we never called `setData` — so when KanbanColumn's
      // `onDrop` read `e.dataTransfer.getData('text/deal-id')` it always
      // returned an empty string and the move request was silently skipped.
      // The deal card LOOKED like it had moved (optimistic onMutate) but
      // the server was never called and onSettled reverted the position.
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', deal.id);
        // 'move' instead of the default 'copy' so the browser doesn't
        // show a "+" cursor on drop targets in some browsers.
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      // 2026-06-26: clicking the card body now navigates to the deal
      // detail page (was: open edit dialog). Users asked for a way to
      // see all quotations attached to a deal — the detail page lists
      // them. The Edit2 icon is still a separate click target below for
      // quick-edit (with stopPropagation).
      onClick={() => { if (!dragging) navigate(`/deals/${deal.id}`); }}
      className={`p-2.5 rounded border bg-card hover:border-primary hover:shadow-sm transition-all cursor-grab active:cursor-grabbing group ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1.5">
            <div className="font-medium text-sm leading-snug flex-1 min-w-0">{deal.title}</div>
            {/* 2026-06-26: owner initials avatar (top-right corner).
                Shows the first character of the owner's name so the
                kanban is scannable for "whose deal is this?" without
                taking horizontal space. Tooltip carries the full
                name + email for disambiguation. */}
            {deal.owner && (
              <span
                className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold"
                title={`銷售員: ${deal.owner.name}${deal.owner.email ? ` <${deal.owner.email}>` : ''}`}
                data-testid="deal-card-owner-initial"
              >
                {deal.owner.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <div className="text-xs text-muted-foreground truncate">
              {deal.company?.name ?? '—'}
            </div>
            <span className="text-sm font-semibold tabular-nums shrink-0">
              {formatCurrency(deal.value, deal.currency)}
            </span>
          </div>
          {/* Quotation entry point:
              - quoteCount > 0 → navigate to the deal detail page where
                the user can see ALL existing quotations and click
                "＋ 新增報價" to add another. This is the answer to the
                2026-06-26 user request: "I can't see all the quotations
                in a deal".
              - quoteCount === 0 → keep the inline QuotationBuilder
                modal so the empty-state CTA is still one click deep
                (frictionless first-quote flow). */}
          {quoteCount > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/deals/${deal.id}`);
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors text-muted-foreground hover:text-foreground"
              title={`查看呢個 deal 嘅 ${quoteCount} 份報價`}
              data-testid="deal-card-view-quotations"
            >
              <FileText className="h-3 w-3" />
              {quoteCount} 份報價
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNewQuotation?.(deal);
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors text-primary font-medium"
              title="為此 deal 建立第一份報價"
            >
              <FileText className="h-3 w-3" />
              ＋ 報價
            </button>
          )}
          {/* Day N+1: "新增 Activity" — log a follow-up note for this
              deal without leaving the Kanban board. Uses the same
              deal-level activity the dashboard's recent-activity widget
              pulls from, so the entry shows up in both places. */}
          {onNewActivity && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNewActivity(deal);
              }}
              className="mt-1 ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors text-muted-foreground hover:text-foreground"
              title="為此 deal 記錄跟進"
            >
              <StickyNote className="h-3 w-3" /> ＋ Activity
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* 2026-06-29: per user request, the destructive action
              (delete) sits at the visual right edge of the card —
              furthest from where the user's eye lands first. Order
              is now [Edit] [Delete] so the Trash icon is the
              rightmost control. */}
          <button
            type="button"
            aria-label="編輯 deal"
            onClick={(e) => { e.stopPropagation(); onEdit(deal); }}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 -m-0.5"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          {onDelete && (
            <button
              type="button"
              aria-label="刪除 deal"
              title="刪除 deal"
              onClick={(e) => { e.stopPropagation(); onDelete(deal); }}
              className="text-muted-foreground hover:text-destructive transition-colors p-0.5 -m-0.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * DealDialog — unified create + edit dialog for Deals.
 *
 * - When `deal` is provided → edit mode (calls `dealsApi.update`).
 * - When `deal` is omitted → create mode (calls `dealsApi.create`).
 *
 * Stage handling in edit mode:
 *   The backend's PATCH /deals/:id does a raw `prisma.deal.update` with
 *   NO status/closedAt side-effect logic. To match the kanban drag-drop
 *   behaviour (auto-set WON/LOST/OPEN + stamp closedAt) we make TWO calls
 *   when the stage changed:
 *     1. PATCH /deals/:id with the rest of the editable fields.
 *     2. PATCH /deals/:id/stage with the new stageId.
 *   The stage endpoint (apps/api/src/routes/deal.ts:69) is the only place
 *   that handles the WON/LOST/closedAt semantics.
 *
 * Day N: now exported so other pages (e.g. Companies list) can mount the
 * same dialog inline when a "+ Deal" button on a company card is clicked.
 * Caller is responsible for providing the `stages` array (typically
 * derived from `dealsApi.kanban()` buckets) and the `companies` list.
 */
export function DealDialog({
  open,
  onOpenChange,
  companies,
  stages,
  defaultCompanyId,
  defaultExpectedCloseDateOffsetDays, // RG-2026-06-07-DEAL-AUTOCOMPLETE: QuotationBuilder
  // Quick-Create passes +90 days (enterprise close cycle) so the user
  // doesn't have to re-pick a sensible default. Defaults to undefined
  // (i.e. blank field) when called from the regular /deals page.
  deal,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  stages: Array<{ id: string; name: string; position: number; probability: number; color: string }>;
  defaultCompanyId?: string;
  /**
   * RG-2026-06-07-DEAL-AUTOCOMPLETE: optional default for the
   * expectedCloseDate field, expressed as days from "now" (positive =
   * future). When set, the field is pre-filled to `today + N days`. When
   * omitted, the field starts blank (existing /deals-page behaviour).
   * QuotationBuilder's Quick-Create passes 90 to match the enterprise
   * close cycle (David 2026-06-07).
   */
  defaultExpectedCloseDateOffsetDays?: number;
  deal?: Deal;
  /**
   * RG-2026-06-07-DEAL-AUTOCOMPLETE: widened from `() => void` to
   * `Optional<(deal?: Deal) => void>` so the QuotationBuilder's
   * DealAutocomplete can auto-select the freshly-created deal.
   * Existing callers (deals.tsx, companies.tsx) pass no argument and
   * continue to work — the parameter is optional.
   */
  onSaved?: (deal?: Deal) => void;
}) {
  const isEdit = !!deal;
  // RG-2026-06-07-DEAL-AUTOCOMPLETE: pre-fill expectedCloseDate to
  // `today + defaultExpectedCloseDateOffsetDays` for Quick-Create flows
  // (offset is +90 in the QuotationBuilder's flow). Existing flows that
  // don't pass the offset get the prior blank-default behaviour.
  const defaultCloseDate = (() => {
    if (typeof defaultExpectedCloseDateOffsetDays !== 'number') return '';
    const d = new Date();
    d.setDate(d.getDate() + defaultExpectedCloseDateOffsetDays);
    return d.toISOString().slice(0, 10);
  })();
  const [title, setTitle] = useState(deal?.title ?? '');
  const [companyId, setCompanyId] = useState(deal?.company?.id ?? defaultCompanyId ?? '');
  const [value, setValue] = useState(deal?.value != null ? String(deal.value) : '');
  const [stageId, setStageId] = useState(deal?.stage?.id ?? stages[0]?.id ?? '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    deal?.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : defaultCloseDate
  );
  // 2026-06-26: 銷售員 picker. In edit mode, pre-fill from the
  // existing deal's owner. In create mode, start empty — the
  // backend defaults ownerId to the authenticated userId when
  // omitted, so the most common case (sales rep creates their own
  // deal) needs no client-side setting.
  const [ownerId, setOwnerId] = useState<string | null>(deal?.owner?.id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the dialog opens OR when stages first arrive. The previous
  // dependency array was `[open, deal?.id]` only, which meant that if the
  // kanban query was still in flight when the user opened the edit dialog,
  // the stage dropdown would lock in `stages[0]` (Lead) and never re-seed
  // even after stages loaded. Adding `stages` to the deps fixes that race
  // — it re-runs once stages arrive and corrects the selection to the
  // deal's real current stage (or keeps the first stage in create mode).
  useEffect(() => {
    if (open) {
      setTitle(deal?.title ?? '');
      setCompanyId(deal?.company?.id ?? defaultCompanyId ?? '');
      setValue(deal?.value != null ? String(deal.value) : '');
      setStageId(deal?.stage?.id ?? stages[0]?.id ?? '');
      setExpectedCloseDate(
        deal?.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : defaultCloseDate
      );
      setOwnerId(deal?.owner?.id ?? null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id, stages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId || !stageId) {
      setError('Company 與 Stage 必填');
      return;
    }
    if (!title.trim()) {
      setError('Deal 名稱必填');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && deal) {
        const stageChanged = stageId !== deal.stage?.id;
        // 1) Update the rest of the editable fields (skip stageId to
        //    avoid bypassing the auto-status logic on the backend).
        //    2026-06-26: also send ownerId when it changed so the
        //    sales rep can be reassigned from the dialog. Use
        //    `undefined` (not null) when unchanged so the backend
        //    doesn't touch the FK on no-op saves.
        await dealsApi.update(deal.id, {
          title: title.trim(),
          value: Number(value) || 0,
          expectedCloseDate: expectedCloseDate || undefined,
          ownerId: ownerId === deal.owner?.id ? undefined : (ownerId || null),
        });
        // 2) If the stage changed, route through the dedicated endpoint
        //    so the backend can set status + closedAt correctly.
        if (stageChanged) {
          await dealsApi.moveStage(deal.id, stageId);
        }
      } else {
        // RG-2026-06-07-DEAL-AUTOCOMPLETE: capture the new deal so the
        // caller (DealAutocomplete) can auto-select it in the
        // QuotationBuilder without an extra roundtrip. The `as Deal`
        // cast is safe — `dealsApi.create` returns `request<Deal>(...)`.
        // 2026-06-26: optionally forward the picked ownerId when
        // the user explicitly chose someone other than themselves.
        // Omitting it lets the backend default to userId.
        const newDeal: Deal = await dealsApi.create({
          title: title.trim(),
          companyId,
          value: Number(value) || 0,
          stageId,
          expectedCloseDate: expectedCloseDate || undefined,
          ownerId: ownerId || undefined,
        });
        if (!isEdit) {
          setTitle(''); setValue(''); setExpectedCloseDate('');
        }
        onSaved?.(newDeal);
        onOpenChange(false);
        return;
      }
      onSaved?.();
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
          <DialogTitle>{isEdit ? '編輯 Deal' : '新增 Deal'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="title">Deal 名稱 *</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="company">公司 *</Label>
              <CompanyAutocomplete
                companies={companies}
                value={companyId}
                onChange={setCompanyId}
                label=""
                disabled={isEdit}
                placeholder={isEdit ? '公司不可修改' : '搜尋客戶名稱...'}
                allowCreate={!isEdit}
              />
            </div>
            <div>
              <Label htmlFor="stage">Stage *</Label>
              <select
                id="stage"
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="w-full h-9 rounded border bg-background px-2 text-sm"
                required
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="value">金額 (HKD)</Label>
              <Input id="value" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="close">預計成交日</Label>
              <Input id="close" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} />
            </div>
          </div>
          {/* 2026-06-26: 銷售員 picker. In edit mode pre-fills from
              deal.owner; in create mode starts empty (backend
              defaults to the authenticated user). User can override
              either way — useful for managers creating deals on
              behalf of reps, or when reassigning a deal. */}
          <div>
            <UserAutocomplete
              value={ownerId}
              onChange={setOwnerId}
            />
          </div>
          {error && (
            <div className="flex items-center justify-between bg-destructive/10 text-destructive text-sm p-2 rounded">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)}><X className="h-3 w-3" /></button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? (isEdit ? '儲存中...' : '建立中...') : (isEdit ? '儲存' : '建立')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
