import { useQuery } from '@tanstack/react-query';
import { KanbanSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { dealsApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export function DealsPage() {
  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['deals'],
    queryFn: () => dealsApi.list({ limit: 100 }),
  });

  const open = deals.filter((d) => d.status === 'OPEN');
  const won = deals.filter((d) => d.status === 'WON');
  const lost = deals.filter((d) => d.status === 'LOST');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Deals</h1>
        <p className="text-muted-foreground">銷售 pipeline 概覽</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Column title="Open" deals={open} variant="info" />
          <Column title="Won" deals={won} variant="success" />
          <Column title="Lost" deals={lost} variant="destructive" />
        </div>
      )}
    </div>
  );
}

function Column({
  title,
  deals,
  variant,
}: {
  title: string;
  deals: { id: string; title: string; value: number; currency: string; company?: { name: string }; stage?: { name: string; probability: number }; probability: number }[];
  variant: 'info' | 'success' | 'destructive';
}) {
  const total = deals.reduce((s, d) => s + d.value, 0);
  return (
    <Card>
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KanbanSquare className="h-4 w-4" />
          <h3 className="font-semibold">{title}</h3>
          <Badge variant="secondary">{deals.length}</Badge>
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>
      <CardContent className="p-3 space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin">
        {deals.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">冇 deal</p>
        ) : (
          deals.map((d) => (
            <div
              key={d.id}
              className="p-3 rounded border bg-card hover:border-primary transition-colors"
            >
              <div className="font-medium text-sm">{d.title}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {d.company?.name ?? '—'}
              </div>
              <div className="flex items-center justify-between mt-2">
                <Badge variant={variant}>{d.stage?.name ?? d.probability + '%'}</Badge>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(d.value, d.currency)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
