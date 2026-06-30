import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { FileText, Plus, Sparkles, Loader2, X, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MultiCompanyAutocomplete } from '@/components/multi-company-autocomplete';
import { MultiUserAutocomplete } from '@/components/multi-user-autocomplete';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { QuotationBuilder } from '@/components/quotation-builder';
import { quotationsApi, chatApi, companiesApi, type Quotation } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

export function QuotationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const presetDealId = searchParams.get('dealId') ?? undefined;
  const presetCompanyId = searchParams.get('companyId') ?? undefined;

  const [builderOpen, setBuilderOpen] = useState(false);
  // Day N+1 (P1-X): the row's "編輯" button stores the target quotation
  // here so the same QuotationBuilder used for create can re-open in
  // edit mode (passing `existing={quotation}`). This reuses the detail
  // page's edit pattern without duplicating the form.
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // 2026-06-09: multi-select Company + sales-rep (createdById) filters.
  // Empty array means "no filter". Wired into the queryKey so a
  // different selection triggers a fresh server fetch.
  const [filterCompanyIds, setFilterCompanyIds] = useState<string[]>([]);
  const [filterCreatedByIds, setFilterCreatedByIds] = useState<string[]>([]);
  // Keep the company list cached so the MultiCompanyAutocomplete and
  // the "X 份" hint can render synchronously.
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-all'],
    queryFn: () => companiesApi.list({ limit: 200 }),
  });
  const { data: quotations = [], isLoading } = useQuery({
    // Stable key — empty array is fine because `JSON.stringify`
    // serializes [] and ['a'] differently.
    queryKey: ['quotations', {
      companyIds: filterCompanyIds,
      createdByIds: filterCreatedByIds,
    }],
    queryFn: () => quotationsApi.list({
      companyIds: filterCompanyIds.length ? filterCompanyIds : undefined,
      createdByIds: filterCreatedByIds.length ? filterCreatedByIds : undefined,
      limit: 50,
    }),
  });

  const hasFilter = filterCompanyIds.length > 0 || filterCreatedByIds.length > 0;
  function clearFilters() {
    setFilterCompanyIds([]);
    setFilterCreatedByIds([]);
  }

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

  // Day N+1 (P1-X): confirm-then-delete from the list row. We invalidate
  // every query that lists quotations (the list, and any kanban that
  // shows a quote count badge) so the row disappears everywhere.
  const deleteQuotation = useMutation({
    mutationFn: (quotationId: string) => quotationsApi.remove(quotationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.invalidateQueries({ queryKey: ['deals-kanban'] });
    },
  });

  // 2026-06-26: editing a quotation from the LIST page needs the full
  // line items, not the list-shape response. The list endpoint
  // (GET /api/quotations) deliberately excludes `items[]` (only returns
  // `_count.items`) for performance — but the QuotationBuilder's edit
  // mode reads `existing.items` to pre-fill the form, so without
  // fetching the full quotation the form opens empty. This was the
  // root cause of the "list-page edit loses historical Product/Service
  // data" bug: the list response has no items at all, so the snapshot
  // data (name / sku / manDaySnapshot) was never reaching the
  // autocomplete. P1-10's snapshot precedence contract assumed the
  // form was opened with the full data — this hook makes that true
  // for the list-page path too.
  //
  // We track `loadingEditId` so the row's 編輯 button can show a
  // spinner + disable itself while the fetch is in flight, and the
  // modal only opens after the full quotation is in hand. We also
  // populate the React Query cache under `['quotation', id]` so a
  // subsequent navigation to /quotations/:id (e.g. clicking 查看)
  // doesn't refetch the same row.
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  async function openEdit(q: Quotation) {
    setLoadingEditId(q.id);
    try {
      const full = await quotationsApi.get(q.id);
      // Pre-seed the detail-page cache. QuotationDetailPage reads the
      // same key, so the user can click 查看 right after editing and
      // see the form's saved version instantly.
      queryClient.setQueryData(['quotation', q.id], full);
      setEditing(full);
    } catch (err) {
      window.alert(`載入報價失敗: ${(err as Error).message}`);
    } finally {
      setLoadingEditId(null);
    }
  }

  // Edit dialog uses the same QuotationBuilder that powers create. The
  // builder detects `existing` and switches to PATCH on save. We just
  // need a separate `open` flag so the create and edit dialogs don't
  // collide (only one QuotationBuilder is mounted at a time).
  const editOpen = editing !== null;
  function closeEdit() {
    setEditing(null);
  }
  function handleEditSaved() {
    closeEdit();
    queryClient.invalidateQueries({ queryKey: ['quotations'] });
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
    // Collect any `draft_quotation` tool_end event from the stream so
    // we can navigate to the new quotation once the agent finishes.
    let draftQuotationId: string | undefined;
    try {
      await chatApi.send(aiPrompt, undefined, (ev) => {
        if (ev.type === 'tool_end' && ev.name === 'draft_quotation') {
          const result = ev.result as { quotationId?: string } | undefined;
          if (result?.quotationId) draftQuotationId = result.quotationId;
        }
      });
      if (draftQuotationId) {
        setAiOpen(false);
        setAiPrompt('');
        queryClient.invalidateQueries({ queryKey: ['quotations'] });
        navigate(`/quotations/${draftQuotationId}`);
        return;
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

      {/* 2026-06-09: Multi-select Company + sales-rep filters for the
          quotation list. Both live in the same row below the page
          header. Each filter is an autocomplete dropdown with chip
          display; the "X 份" hint shows the active filter's company
          names (or sales-rep names) and a clear-all button. */}
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
            value={filterCreatedByIds}
            onChange={setFilterCreatedByIds}
            label="銷售員"
            placeholder="搜尋銷售員..."
          />
        </div>
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" />
            清除 filter
          </Button>
        )}
        {hasFilter && (
          <div className="text-sm text-muted-foreground pb-2 w-full">
            顯示 {quotations.length} 份 quotation
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

      {/* Day N+1 (P1-X): edit dialog — reuses the same QuotationBuilder
          that powers the create flow. Passing `existing={quotation}`
          switches the builder into PATCH mode; the onSaved callback
          closes the dialog and invalidates the list query. The same
          component is used by the detail page (see
          apps/web/src/pages/quotation-detail.tsx) so we don't duplicate
          the form. */}
      <Dialog open={editOpen} onOpenChange={(o) => (o ? null : closeEdit())}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>編輯報價單 {editing?.number ?? ''}</DialogTitle>
          </DialogHeader>
          {editing && (
            <QuotationBuilder
              existing={editing}
              onSaved={handleEditSaved}
              onCancel={closeEdit}
            />
          )}
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
                    {/* 2026-06-26: 銷售員 column. Sales-rep filter
                        already exists at the top of the page; the
                        table column closes the loop so users can see
                        who's responsible per row without opening the
                        detail page. Falls back to the creator when
                        salesRepId is null. */}
                    <th className="px-4 py-3 font-medium">銷售員</th>
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
                        {formatCurrency(q.total, q.currency)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {q.salesRep?.name ?? q.createdBy?.name ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatDate(q.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/quotations/${q.id}`}>查看</Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(q)}
                            disabled={loadingEditId === q.id}
                            data-testid="quotation-row-edit"
                          >
                            {loadingEditId === q.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              '編輯'
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (confirm(`確定刪除 quotation「${q.number}」?此操作無法復原,line items 會一齊 cascade。`)) {
                                deleteQuotation.mutate(q.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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
