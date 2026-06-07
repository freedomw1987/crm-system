import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Sparkles, Loader2, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label, Select } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { QuotationBuilder } from '@/components/quotation-builder';
import { quotationsApi, chatApi, companiesApi, type Quotation } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

// 2026-06-06: "ALL" sentinel for the company filter <select>. Kept as a
// module-level constant so it's easy to grep and matches the deals page.
const COMPANY_FILTER_ALL = '__all__';

export function QuotationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const presetDealId = searchParams.get('dealId') ?? undefined;
  const presetCompanyId = searchParams.get('companyId') ?? undefined;

  const [builderOpen, setBuilderOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // 2026-06-06: Company filter — empty string means "all companies".
  // Wired into the quotations list queryKey so changing the filter
  // refetches the table from the server.
  const [filterCompanyId, setFilterCompanyId] = useState<string>('');
  // Pull all companies for the filter dropdown. Same pattern the deals
  // page uses; limit 200 covers the realistic customer count.
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-all'],
    queryFn: () => companiesApi.list({ limit: 200 }),
  });
  const { data: quotations = [], isLoading } = useQuery({
    // Include the filter in the queryKey so a different selection
    // triggers a fresh server fetch (not a stale cache hit).
    queryKey: ['quotations', { companyId: filterCompanyId || null }],
    queryFn: () => quotationsApi.list(filterCompanyId ? { companyId: filterCompanyId, limit: 50 } : { limit: 50 }),
  });

  // Auto-open the builder when navigated in with ?dealId=... or
  // ?companyId=... so a deal-card shortcut (「＋ 報價」) or a
  // company-detail shortcut (「+ 新增 Quotation」) can land here with
  // the deal / company pre-filled. We clear the query string on close
  // so a refresh doesn't re-open the dialog.
  useEffect(() => {
    if (presetDealId || presetCompanyId) {
      setBuilderOpen(true);
    }
  }, [presetDealId, presetCompanyId]);

  function closeBuilder() {
    setBuilderOpen(false);
    if (presetDealId || presetCompanyId) {
      // Strip both possible presets from the URL after the dialog closes.
      const next = new URLSearchParams(searchParams);
      next.delete('dealId');
      next.delete('companyId');
      setSearchParams(next, { replace: true });
    }
  }

  function handleBuilderSaved(q: Quotation) {
    closeBuilder();
    queryClient.invalidateQueries({ queryKey: ['quotations'] });
    navigate(`/quotations/${q.id}`);
  }

  async function handleAiDraft() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await chatApi.send(aiPrompt);
      const quotationToolCall = result.toolCalls.find((tc) => tc.name === 'draft_quotation');
      if (quotationToolCall) {
        const draftResult = quotationToolCall.result as { quotationId?: string };
        if (draftResult?.quotationId) {
          setAiOpen(false);
          setAiPrompt('');
          queryClient.invalidateQueries({ queryKey: ['quotations'] });
          navigate(`/quotations/${draftResult.quotationId}`);
          return;
        }
      }
      setAiError('AI 冇整到 quotation,睇下 chat 了解詳情');
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Quotations</h1>
          <p className="text-muted-foreground">所有報價單</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAiOpen(true)}>
            <Sparkles className="h-4 w-4 mr-2" />
            AI Draft
          </Button>
          <Button onClick={() => setBuilderOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            新報價
          </Button>
        </div>
      </div>

      {/* 2026-06-06: Company filter for the quotation list. Mirrors the
          deals page filter — same <Select> pattern, same "全部" sentinel
          semantics. Lives on its own row below the page header so it
          doesn't crowd the action buttons on the right. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="quotation-company-filter" className="text-xs text-muted-foreground">
            Company
          </Label>
          <Select
            id="quotation-company-filter"
            value={filterCompanyId || COMPANY_FILTER_ALL}
            onChange={(e) => {
              const v = e.target.value;
              setFilterCompanyId(v === COMPANY_FILTER_ALL ? '' : v);
            }}
            className="w-56"
          >
            <option value={COMPANY_FILTER_ALL}>全部 Company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {filterCompanyId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilterCompanyId('')}
            className="text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" />
            清除 filter
          </Button>
        )}
        {filterCompanyId && (
          <div className="text-sm text-muted-foreground pb-2">
            顯示「{companies.find((c) => c.id === filterCompanyId)?.name ?? '…'}」嘅 quotation
            {quotations.length === 1 ? '' : 's'} · {quotations.length} 份
          </div>
        )}
      </div>

      {/* New Quotation Dialog (builder) */}
      <Dialog open={builderOpen} onOpenChange={(o) => (o ? setBuilderOpen(true) : closeBuilder())}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>建立新報價單</DialogTitle>
          </DialogHeader>
          <QuotationBuilder
            initialDealId={presetDealId}
            initialCompanyId={presetCompanyId}
            onSaved={handleBuilderSaved}
            onCancel={closeBuilder}
          />
        </DialogContent>
      </Dialog>

      {/* AI Draft Dialog */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 報價助手</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              用自然語言講你想點報,例如:
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
              <li>「幫 ABC Company 開個 5 個 AC01 同 2 個 AC02 嘅 quotation」</li>
              <li>「幫我整個 deal 客戶嘅 starter pack」</li>
            </ul>
            <Textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="你想點報..."
              rows={4}
            />
            {aiError && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                {aiError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setAiOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAiDraft} disabled={aiLoading || !aiPrompt.trim()}>
              {aiLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  AI 諗緊...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  生成草稿
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : quotations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
            未有報價單,撳「+ 新報價」整第一個
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((q) => (
                    <tr key={q.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs">
                        {q.generatedByAi && (
                          <Sparkles className="inline h-3 w-3 mr-1 text-purple-600" />
                        )}
                        {q.number}
                      </td>
                      <td className="px-4 py-3 max-w-[200px] truncate">
                        {q.title ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">{q.company?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <QuotationStatusBadge status={q.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(q.total)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatDate(q.createdAt)}
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
      )}
    </div>
  );
}

function QuotationStatusBadge({ status }: { status: string }) {
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
