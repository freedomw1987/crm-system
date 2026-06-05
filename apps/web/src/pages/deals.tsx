import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { KanbanSquare, Plus, GripVertical, X } from 'lucide-react';
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
  const [createOpen, setCreateOpen] = useState(false);
  const { data: kanban, isLoading } = useQuery({
    queryKey: ['deals-kanban'],
    queryFn: () => dealsApi.kanban(),
  });
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-all'],
    queryFn: () => companiesApi.list({ limit: 200 }),
  });

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
              />
            ))}
          </div>
        </div>
      )}

      <CreateDealDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companies={companies}
        stages={kanban?.buckets.map((b) => b.stage) ?? []}
        defaultCompanyId={companies[0]?.id}
        onCreated={() => qc.invalidateQueries({ queryKey: ['deals-kanban'] })}
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
}: {
  stage: { id: string; name: string; probability: number; color: string };
  deals: Deal[];
  onDrop: (dealId: string) => void;
  isMoving: boolean;
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
            <DealCard key={d.id} deal={d} disabled={isMoving} />
          ))
        )}
      </div>
      <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t">
        Probability: {stage.probability}%
      </div>
    </div>
  );
}

function DealCard({ deal, disabled }: { deal: Deal; disabled: boolean }) {
  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', deal.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
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
          {deal._count && deal._count.quotations > 0 && (
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              📄 {deal._count.quotations} quotation(s)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateDealDialog({
  open,
  onOpenChange,
  companies,
  stages,
  defaultCompanyId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  stages: Array<{ id: string; name: string; position: number; probability: number; color: string }>;
  defaultCompanyId?: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? '');
  const [value, setValue] = useState('');
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId || !stageId) {
      setError('Company 與 Stage 必填');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await dealsApi.create({
        title,
        companyId,
        value: Number(value) || 0,
        stageId,
        expectedCloseDate: expectedCloseDate || undefined,
      });
      setTitle(''); setValue(''); setExpectedCloseDate('');
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
          <DialogTitle>新增 Deal</DialogTitle>
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
              >
                <option value="">— 揀公司 —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.region ?? 'HK'})
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
            <Button type="submit" disabled={submitting || !title}>{submitting ? '建立中...' : '建立'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
