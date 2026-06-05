import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, Mail, Phone, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { companiesApi, quotationsApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
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

  if (isLoading) return <p>載入中...</p>;
  if (!company) return <p>搵唔到呢間公司</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/companies">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{company.name}</h1>
          {company.legalName && (
            <p className="text-sm text-muted-foreground">{company.legalName}</p>
          )}
        </div>
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

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Quotations ({quotations.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {quotations.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">
                仲未有報價單
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
      </div>
    </div>
  );
}
