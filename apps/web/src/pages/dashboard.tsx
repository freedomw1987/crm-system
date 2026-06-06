import { useQuery } from '@tanstack/react-query';
import { Building2, FileText, KanbanSquare, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { companiesApi, quotationsApi, dealsApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { RecentActivitiesWidget } from '@/components/activity-feed';

export function DashboardPage() {
  // Day 9 fix: Dashboard KPIs (Open Deals, Win Rate, Pipeline Value) need
  // full-population stats, not just the first 5 records. The previous code
  // fetched `limit: 5` and reduced on the result, so once the DB had more
  // than 5 deals the open-deals count and win rate silently froze on
  // "5 deals, X open" no matter what was actually in the pipeline.
  //
  // We now fetch a large ceiling (1000) and coerce every Decimal field
  // with `Number(...)` to dodge Prisma's string-vs-`+` trap. A real product
  // would expose a `/deals/stats` summary endpoint so we don't load 1000
  // rows just to count them; for now this works because David's CRM has
  // < 1k deals.
  const STATS_LIMIT = 1000;
  const { data: companies = [] } = useQuery({
    queryKey: ['companies', { limit: STATS_LIMIT }],
    queryFn: () => companiesApi.list({ limit: STATS_LIMIT }),
  });
  const { data: quotations = [] } = useQuery({
    queryKey: ['quotations', { limit: STATS_LIMIT }],
    queryFn: () => quotationsApi.list({ limit: STATS_LIMIT }),
  });
  const { data: deals = [] } = useQuery({
    queryKey: ['deals', { limit: STATS_LIMIT }],
    queryFn: () => dealsApi.list({ limit: STATS_LIMIT }),
  });

  const totalQuotationValue = quotations.reduce((s, q) => s + Number(q.total), 0);
  const openDeals = deals.filter((d) => d.status === 'OPEN');
  const pipelineValue = openDeals.reduce((s, d) => s + Number(d.value), 0);
  const wonDeals = deals.filter((d) => d.status === 'WON');

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
          hint="全部 active companies"
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
              ? Math.round((wonDeals.length / deals.length) * 100) + '%'
              : '—'
          }
          hint="Won / Total"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Recent Quotations</CardTitle>
          </CardHeader>
          <CardContent>
            {quotations.length === 0 ? (
              <p className="text-sm text-muted-foreground">未有報價單</p>
            ) : (
              <ul className="space-y-2">
                {quotations.slice(0, 5).map((q) => (
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
                {deals.slice(0, 5).map((d) => (
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

        {/* Day N: most-recent activity across the whole workspace. Read-only
            here; full composer lives on each company/deal detail page. */}
        <RecentActivitiesWidget limit={5} />
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
