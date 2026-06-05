import { useQuery } from '@tanstack/react-query';
import { Building2, FileText, KanbanSquare, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { companiesApi, quotationsApi, dealsApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

export function DashboardPage() {
  const { data: companies = [] } = useQuery({
    queryKey: ['companies', { limit: 5 }],
    queryFn: () => companiesApi.list({ limit: 5 }),
  });
  const { data: quotations = [] } = useQuery({
    queryKey: ['quotations', { limit: 5 }],
    queryFn: () => quotationsApi.list({ limit: 5 }),
  });
  const { data: deals = [] } = useQuery({
    queryKey: ['deals', { limit: 5 }],
    queryFn: () => dealsApi.list({ limit: 5 }),
  });

  const totalQuotationValue = quotations.reduce((s, q) => s + q.total, 0);
  const openDeals = deals.filter((d) => d.status === 'OPEN');
  const pipelineValue = openDeals.reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">歡迎返嚟,睇下今日嘅 overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Building2}
          label="Companies"
          value={companies.length}
          hint="最近 5 個 active"
          to="/companies"
        />
        <KpiCard
          icon={FileText}
          label="Quotations"
          value={quotations.length}
          hint={formatCurrency(totalQuotationValue)}
          to="/quotations"
        />
        <KpiCard
          icon={KanbanSquare}
          label="Open Deals"
          value={openDeals.length}
          hint={formatCurrency(pipelineValue) + ' pipeline'}
          to="/deals"
        />
        <KpiCard
          icon={TrendingUp}
          label="Win Rate"
          value={
            deals.length > 0
              ? Math.round(
                  (deals.filter((d) => d.status === 'WON').length / deals.length) * 100
                ) + '%'
              : '—'
          }
          hint="Won / Total"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Recent Quotations</CardTitle>
          </CardHeader>
          <CardContent>
            {quotations.length === 0 ? (
              <p className="text-sm text-muted-foreground">未有報價單</p>
            ) : (
              <ul className="space-y-2">
                {quotations.map((q) => (
                  <li key={q.id} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/quotations/${q.id}`}
                        className="font-medium hover:underline truncate block"
                      >
                        {q.number}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {q.company?.name} · {formatDate(q.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={q.status} />
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(q.total)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Deals</CardTitle>
          </CardHeader>
          <CardContent>
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">未有 deal</p>
            ) : (
              <ul className="space-y-2">
                {deals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{d.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.company?.name} · {d.stage?.name ?? 'No stage'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          d.status === 'WON' ? 'success' : d.status === 'LOST' ? 'destructive' : 'info'
                        }
                      >
                        {d.status}
                      </Badge>
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(d.value, d.currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  hint?: string;
  to?: string;
}) {
  const inner = (
    <Card className={to ? 'hover:border-primary transition-colors' : ''}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
          </div>
          <div className="h-10 w-10 rounded bg-primary/10 text-primary flex items-center justify-center">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, 'default' | 'secondary' | 'info' | 'success' | 'warning' | 'destructive'> = {
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
