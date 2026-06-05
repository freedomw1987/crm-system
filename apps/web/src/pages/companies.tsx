import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { companiesApi, type Company } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';

export function CompaniesPage() {
  const [query, setQuery] = useState('');
  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies', { query }],
    queryFn: () => companiesApi.list({ query: query || undefined, limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Companies</h1>
        <p className="text-muted-foreground">所有客戶公司</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜尋公司名 / email / industry..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : companies.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            搵唔到任何公司
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((c) => (
            <CompanyCard key={c.id} company={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCard({ company }: { company: Company }) {
  return (
    <Link to={`/companies/${company.id}`}>
      <Card className="hover:border-primary transition-colors h-full">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{company.name}</h3>
              {company.industry && (
                <p className="text-sm text-muted-foreground">{company.industry}</p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant={company.status === 'active' ? 'success' : 'secondary'}>
                  {company.status}
                </Badge>
                {company._count && (
                  <span className="text-xs text-muted-foreground">
                    {company._count.contacts} 聯絡人 ·{' '}
                    {company._count.quotations} 報價 ·{' '}
                    {company._count.deals} deals
                  </span>
                )}
              </div>
              {company._count && company._count.quotations > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  最近更新: {formatDate(new Date())}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
