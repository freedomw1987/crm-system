import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KanbanSquare, Plus, GripVertical, X, Edit2, FileText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { dealsApi, companiesApi, type KanbanData, type Deal, type Company } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export function DealsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const presetCompanyId = searchParams.get('companyId') ?? undefined;
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const { data: kanban, isLoading } = useQuery({
    queryKey: ['deals-kanban'],
    queryFn: () => dealsApi.kanban(),
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

  // Move-deal mutation with optimistic update
  const moveStage = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      dealsApi.moveStage(dealId, stageId),
    onMutate: async ({ dealId, stageId }) => {
      await qc.cancelQueries({ queryKey: ['deals-kanban'] });
      const previous = qc.getQueryData<KanbanData>(['deals-kanban']);
      if (previous) {
        const next: KanbanData = {
          ...previous,
          buckets: previous.buckets.map((b) => ({ ...b, deals: [...b.deals] })),
        };
        // Find and remove the deal from its current bucket
        let movedDeal: Deal | undefined;
        for (const b of next.buckets) {
          const idx = b.deals.findIndex((d) => d.id === dealId);
          if (idx !== -1) {
            movedDeal = b.deals[idx];
            b.deals.splice(idx, 1);
            break;
          }
        }
        // Add it to the new bucket
        const targetBucket = next.buckets.find((b) => b.stage.id === stageId);
        if (targetBucket && movedDeal) {
          targetBucket.deals.unshift({ ...movedDeal, stage: targetBucket.stage });
        }
        qc.setQueryData(['deals-kanban'], next);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['deals-kanban'], ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['deals-kanban'] });
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
            <div className="font-semibold">{stats.openCount} deals · {formatCurrency(stats.totalValue)}</div>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> 新增 Deal
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open Deals" value={`${stats.openCount}`} />
        <StatCard label="Total Value" value={formatCurrency(stats.totalValue)} />
        <StatCard label="Weighted (by prob.)" value={formatCurrency(stats.weightedValue)} highlight />
        <StatCard label="Stages" value={`${kanban?.buckets.length ?? 0}`} />
      </div>

      {isLoading || !kanban ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {kanban.buckets.map((bucket) => (
              <KanbanColumn
                key={bucket.stage.id}
                stage={bucket.stage}
                deals={bucket.deals}
                onDrop={(dealId) => moveStage.mutate({ dealId, stageId: bucket.stage.id })}
                isMoving={moveStage.isPending}
                onEdit={(deal) => setEditing(deal)}
              />
            ))}
          </div>
        </div>
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
  onEdit,
}: {
  stage: { id: string; name: string; probability: number; color: string };
  deals: Deal[];
  onDrop: (dealId: string) => void;
  isMoving: boolean;
  onEdit: (deal: Deal) => void;
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
          {formatCurrency(total)}
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
            <DealCard key={d.id} deal={d} disabled={isMoving} onEdit={onEdit} />
          ))
        )}
      </div>
      <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t">
        Probability: {stage.probability}%
      </div>
    </div>
  );
}

function DealCard({ deal, disabled, onEdit }: { deal: Deal; disabled: boolean; onEdit: (d: Deal) => void }) {
  // Track drag state so a click on the card body doesn't open the edit
  // dialog while the user is mid-drag.
  const [dragging, setDragging] = useState(false);
  const navigate = useNavigate();
  const quoteCount = deal._count?.quotations ?? 0;
  return (
    <div
      draggable={!disabled}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      onClick={() => { if (!dragging) onEdit(deal); }}
      className={`p-2.5 rounded border bg-card hover:border-primary hover:shadow-sm transition-all cursor-grab active:cursor-grabbing group ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm leading-snug">{deal.title}</div>
          <div className="flex items-center justify-between mt-1.5">
            <div className="text-xs text-muted-foreground truncate">
              {deal.company?.name ?? '—'}
            </div>
            <span className="text-sm font-semibold tabular-nums shrink-0">
              {formatCurrency(deal.value, deal.currency)}
            </span>
          </div>
          {/* Quotation entry point: navigate to /quotations?dealId=... so the
              builder auto-opens with the deal pre-filled. Show "+ 報價" when
              no quotes exist yet (CTA), or the count when there are some. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/quotations?dealId=${deal.id}`);
            }}
            className={`mt-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors ${
              quoteCount > 0
                ? 'text-muted-foreground hover:text-foreground'
                : 'text-primary font-medium'
            }`}
            title={quoteCount > 0 ? `已有 ${quoteCount} 份報價,撳再加一份` : '為此 deal 建立報價'}
          >
            <FileText className="h-3 w-3" />
            {quoteCount > 0 ? `${quoteCount} 份報價 · ＋` : '＋ 報價'}
          </button>
        </div>
        <button
          type="button"
          aria-label="編輯 deal"
          onClick={(e) => { e.stopPropagation(); onEdit(deal); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity p-0.5 -m-0.5"
        >
          <Edit2 className="h-3.5 w-3.5" />
        </button>
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
 */
function DealDialog({
  open,
  onOpenChange,
  companies,
  stages,
  defaultCompanyId,
  deal,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  stages: Array<{ id: string; name: string; position: number; probability: number; color: string }>;
  defaultCompanyId?: string;
  deal?: Deal;
  onSaved: () => void;
}) {
  const isEdit = !!deal;
  const [title, setTitle] = useState(deal?.title ?? '');
  const [companyId, setCompanyId] = useState(deal?.company?.id ?? defaultCompanyId ?? '');
  const [value, setValue] = useState(deal?.value != null ? String(deal.value) : '');
  const [stageId, setStageId] = useState(deal?.stage?.id ?? stages[0]?.id ?? '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    deal?.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the dialog opens — handles edit-mode re-open with a
  // different deal, and keeps `companyId`/`stageId` valid when stages
  // arrive after the dialog first mounts (async kanban query).
  // We reseed on `open` only, not on `stages` — see useEffect below.
  useEffect(() => {
    if (open) {
      setTitle(deal?.title ?? '');
      setCompanyId(deal?.company?.id ?? defaultCompanyId ?? '');
      setValue(deal?.value != null ? String(deal.value) : '');
      setStageId(deal?.stage?.id ?? stages[0]?.id ?? '');
      setExpectedCloseDate(deal?.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : '');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id]);

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
        await dealsApi.update(deal.id, {
          title: title.trim(),
          value: Number(value) || 0,
          expectedCloseDate: expectedCloseDate || undefined,
        });
        // 2) If the stage changed, route through the dedicated endpoint
        //    so the backend can set status + closedAt correctly.
        if (stageChanged) {
          await dealsApi.moveStage(deal.id, stageId);
        }
      } else {
        await dealsApi.create({
          title: title.trim(),
          companyId,
          value: Number(value) || 0,
          stageId,
          expectedCloseDate: expectedCloseDate || undefined,
        });
      }
      if (!isEdit) {
        setTitle(''); setValue(''); setExpectedCloseDate('');
      }
      onSaved();
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
              <select
                id="company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="w-full h-9 rounded border bg-background px-2 text-sm"
                required
                disabled={isEdit}
              >
                <option value="">— 揀公司 —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.region?.code ?? 'HK'})
                  </option>
                ))}
              </select>
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
