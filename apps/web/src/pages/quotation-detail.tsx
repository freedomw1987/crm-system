import { useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Sparkles, User, Printer, Edit, Send, Check, X, Trash2, FileDown, FileText, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QuotationBuilder } from '@/components/quotation-builder';
import { LineItemSnapshotMeta } from '@/components/quotation-line-item-snapshot';
import { quotationsApi, type Quotation, type QuotationStatus } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

export function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isPrintMode = searchParams.get('print') === '1';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: quotation, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => quotationsApi.get(id!),
    enabled: !!id,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<QuotationStatus | null>(null);
  // 2026-06-07 (US-A5): Excel download state. error shown inline; filename
  // is the actual file delivered (so toast/tooltip can echo it).
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);
  // 2026-06-26: revise-flow state. setReviseConfirmOpen toggles
  // the confirm dialog; `revising` disables the action button
  // while the backend call is in flight and is reused for the
  // button's spinner.
  const [reviseConfirmOpen, setReviseConfirmOpen] = useState(false);
  const [revising, setRevising] = useState(false);

  // 2026-06-07 (US-A5): Trigger xlsx download via quotationsApi.downloadExcel.
  // Resets error on each attempt so a previous failure doesn't bleed across.
  async function handleDownloadExcel() {
    if (!id) return;
    setExcelError(null);
    setExcelDownloading(true);
    try {
      const filename = await quotationsApi.downloadExcel(id, { lang: 'zh', version: 'v2' });
      console.log('[excel-download] saved as', filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExcelError(msg);
      console.error('[excel-download] failed:', msg);
    } finally {
      setExcelDownloading(false);
    }
  }

  if (isLoading) return <p>載入中...</p>;
  if (!quotation) return <p>搵唔到呢張報價單</p>;

  async function transition(status: QuotationStatus) {
    if (!id) return;
    setActionLoading(status);
    try {
      await quotationsApi.setStatus(id, status);
      queryClient.invalidateQueries({ queryKey: ['quotation', id] });
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    if (!id) return;
    if (!window.confirm('確定刪除呢張報價單?')) return;
    try {
      await quotationsApi.remove(id);
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      window.history.back();
    } catch (err) {
      window.alert(`刪除失敗: ${(err as Error).message}`);
    }
  }

  function handleBuilderSaved() {
    setEditOpen(false);
    queryClient.invalidateQueries({ queryKey: ['quotation', id] });
    queryClient.invalidateQueries({ queryKey: ['quotations'] });
  }

  // 2026-06-26: revise flow. The backend's POST /:id/revise
  // clones the source as a new DRAFT and returns it; we
  // navigate to the new id so the user lands on the editable
  // draft immediately. Both `['quotation', newId]` and
  // `['quotation', id]` are pre-seeded in the cache so
  // navigation back to the source (e.g. via the back button)
  // doesn't refetch.
  async function handleRevise() {
    if (!id) return;
    setRevising(true);
    try {
      const newQuotation = await quotationsApi.revise(id);
      setReviseConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.setQueryData(['quotation', newQuotation.id], newQuotation);
      navigate(`/quotations/${newQuotation.id}`);
    } catch (err) {
      window.alert(`建立修訂失敗: ${(err as Error).message}`);
    } finally {
      setRevising(false);
    }
  }

  function handlePrint() {
    // Open print-friendly route in same tab, then trigger window.print
    setSearchParams({ print: '1' });
    setTimeout(() => window.print(), 200);
  }

  // --- Print-mode layout ---
  if (isPrintMode) {
    return (
      <div className="bg-white text-black p-8 max-w-3xl mx-auto print:p-0">
        <div className="flex justify-between items-start border-b pb-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">報價單 / Quotation</h1>
            <p className="font-mono text-sm text-gray-600 mt-1">{quotation.number}</p>
          </div>
          <div className="text-right text-sm">
            <p><span className="text-gray-500">Issue date:</span> {formatDate(quotation.createdAt)}</p>
            {quotation.validUntil && (
              <p><span className="text-gray-500">Valid until:</span> {formatDate(quotation.validUntil)}</p>
            )}
            <p><span className="text-gray-500">Status:</span> {quotation.status}</p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wide">To</p>
          <p className="font-semibold text-lg">{quotation.company?.name}</p>
          {quotation.company?.email && <p className="text-sm">{quotation.company.email}</p>}
          {quotation.company?.phone && <p className="text-sm">{quotation.company.phone}</p>}
        </div>

        {quotation.title && (
          <p className="text-lg font-medium mb-4">{quotation.title}</p>
        )}

        <table className="w-full text-sm border-t border-b mb-4">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th>
              <th className="py-2 text-right">Disc</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {quotation.items.map((item) => (
              <tr key={item.id ?? item.name} className="border-b last:border-0 align-top">
                <td className="py-2">
                  <div className="font-medium">{item.name}</div>
                  {item.sku && <div className="text-xs text-gray-500">SKU: {item.sku}</div>}
                  <LineItemSnapshotMeta item={item} print />
                </td>
                <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                <td className="py-2 text-right tabular-nums">{formatCurrency(item.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums">
                  {item.discount > 0 ? `${item.discount}%` : '—'}
                </td>
                <td className="py-2 text-right tabular-nums font-semibold">{formatCurrency(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-64 text-sm space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(quotation.subtotal)}</span></div>
            <div className="flex justify-between"><span>Tax ({quotation.taxRate}%)</span><span className="tabular-nums">{formatCurrency(quotation.taxAmount)}</span></div>
            <div className="flex justify-between border-t pt-2 mt-2 text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(quotation.total)}</span>
            </div>
          </div>
        </div>

        {quotation.notes && (
          <div className="mt-6 text-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="whitespace-pre-wrap">{quotation.notes}</p>
          </div>
        )}

        <div className="mt-8 pt-4 border-t text-xs text-gray-500 flex justify-between print:hidden">
          <Button variant="outline" onClick={() => setSearchParams({})}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            列印
          </Button>
        </div>
      </div>
    );
  }

  // --- Normal mode ---
  const isDraft = quotation.status === 'DRAFT';
  const isSent = ['SENT', 'VIEWED'].includes(quotation.status);
  const isAccepted = quotation.status === 'ACCEPTED';

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/quotations">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold font-mono">{quotation.number}</h1>
              {quotation.generatedByAi && (
                <Badge variant="info">
                  <Sparkles className="h-3 w-3 mr-1" />
                  AI Generated
                </Badge>
              )}
              <QuotationStatusBadge status={quotation.status} />
              {/* 2026-06-26: revision chip. When this quotation has a
                  parent (i.e. it's a revision), show a small chip
                  linking to the parent so the user can navigate
                  back to the original. The chip text follows the
                  standard "修訂自 X" pattern. Hidden for the root
                  quotation (no parent). */}
              {quotation.parentQuotation && (
                <Button asChild variant="outline" size="sm" className="h-6 px-2 text-xs" data-testid="quotation-revision-of">
                  <Link to={`/quotations/${quotation.parentQuotation.id}`}>
                    修訂自 {quotation.parentQuotation.number}
                  </Link>
                </Button>
              )}
              {/* 2026-06-26: revision-number badge so the chain
                  position is visible at a glance. "R1" / "R2" /
                  etc. only renders for revisionNumber >= 1. The
                  root quotation (R0) skips the badge since the
                  number itself (Q-2026-0001) is the indicator. */}
              {quotation.revisionNumber != null && quotation.revisionNumber > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  R{quotation.revisionNumber}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {quotation.company?.name} · 建立於 {formatDate(quotation.createdAt)}
              {quotation.title && ` · ${quotation.title}`}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            列印
          </Button>
          {/* 2026-06-07 (US-A5): Download as .xlsx — available for ALL statuses
              (DRAFT, SENT, ACCEPTED, ...) so sales can re-download historical
              quotations. Backend route: GET /api/quotations/:id/export-xlsx */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadExcel}
            disabled={excelDownloading}
            data-testid="quotation-download-excel"
          >
            {excelDownloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            下載 Excel
          </Button>
          {excelError && (
            <p className="text-sm text-destructive self-center" role="alert">
              {excelError}
            </p>
          )}
          {isDraft && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Edit className="h-4 w-4 mr-2" />
                編輯
              </Button>
              <Button size="sm" onClick={() => transition('SENT')} disabled={actionLoading === 'SENT'}>
                <Send className="h-4 w-4 mr-2" />
                發送
              </Button>
              <Button variant="outline" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                刪除
              </Button>
            </>
          )}
          {isSent && (
            <>
              <Button size="sm" onClick={() => transition('ACCEPTED')} disabled={actionLoading === 'ACCEPTED'}>
                <Check className="h-4 w-4 mr-2" />
                標記接受
              </Button>
              <Button variant="outline" size="sm" onClick={() => transition('REJECTED')} disabled={actionLoading === 'REJECTED'}>
                <X className="h-4 w-4 mr-2" />
                拒絕
              </Button>
            </>
          )}
          {isAccepted && (
            <Button size="sm" onClick={() => transition('INVOICED')} disabled={actionLoading === 'INVOICED'}>
              轉成發票
            </Button>
          )}
          {/* 2026-06-26: 建立修訂 button. Visible on every non-DRAFT
              status (SENT/VIEWED/ACCEPTED/REJECTED/EXPIRED/INVOICED)
              because the SENT lock freezes the contractual fields
              on all of them. Click opens a confirm dialog (set below)
              then navigates to the new DRAFT for editing. */}
          {!isDraft && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setReviseConfirmOpen(true)}
              disabled={revising}
              data-testid="quotation-revise"
            >
              {revising ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              建立修訂
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr className="text-left">
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Unit</th>
                    <th className="px-4 py-3 text-right">Disc</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quotation.items.map((item) => (
                    <tr key={item.id ?? item.name} className="border-b last:border-0 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.name}</div>
                        {item.sku && (
                          <div className="text-xs text-muted-foreground">SKU: {item.sku}</div>
                        )}
                        <LineItemSnapshotMeta item={item} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {item.discount > 0 ? `${item.discount}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(item.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {quotation.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{quotation.notes}</p>
              </CardContent>
            </Card>
          )}

          {quotation.generatedByAi && quotation.aiPrompt && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  AI Audit Trail
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">用戶 prompt:</p>
                <p className="text-sm bg-muted p-3 rounded italic">"{quotation.aiPrompt}"</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(quotation.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax ({quotation.taxRate}%)</span>
                <span className="tabular-nums">{formatCurrency(quotation.taxAmount)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold text-base">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(quotation.total)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-sm space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-3 w-3" />
                <span>建立人: {quotation.createdBy?.name ?? '—'}</span>
              </div>
              {/* 2026-06-26: sales-rep row. The follow-up salesperson
                  is separate from the creator (e.g. a sales engineer
                  builds the quote, an account exec follows up with
                  the customer). Falls back to createdBy.name when
                  salesRepId is null, which is the historical
                  behaviour (the creator was implicitly the rep). */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="inline-block h-3 w-3 rounded-full bg-primary/20 text-primary text-[8px] font-semibold leading-3 text-center">
                  {(quotation.salesRep?.name ?? quotation.createdBy?.name ?? '—').slice(0, 1).toUpperCase()}
                </span>
                <span>銷售員: {quotation.salesRep?.name ?? quotation.createdBy?.name ?? '—'}</span>
              </div>
              {quotation.validUntil && (
                <p className="text-xs text-muted-foreground">
                  有效至: {formatDate(quotation.validUntil)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                建立: {formatDateTime(quotation.createdAt)}
              </p>
              {quotation.sentAt && (
                <p className="text-xs text-muted-foreground">
                  發送: {formatDateTime(quotation.sentAt)}
                </p>
              )}
              {quotation.acceptedAt && (
                <p className="text-xs text-muted-foreground">
                  接受: {formatDateTime(quotation.acceptedAt)}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>編輯報價單 {quotation.number}</DialogTitle>
          </DialogHeader>
          <QuotationBuilder
            existing={quotation}
            onSaved={handleBuilderSaved}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* 2026-06-26: revise confirm dialog. Warns the user that
          the original quotation stays untouched (it's SENT/etc
          so they can't edit it anyway) and a new DRAFT will be
          created with the same customer / deal / line items.
          The clone carries a fresh sequential number; the
          original keeps its Q-2026-0001 identity. */}
      <Dialog open={reviseConfirmOpen} onOpenChange={setReviseConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>建立 {quotation.number} 嘅修訂?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>呢個動作會：</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>保留原本嘅 <span className="font-mono">{quotation.number}</span>（唔會郁佢）</li>
              <li>複製客戶、Deal、銷售同事、所有 line items（同 snapshot）</li>
              <li>開一個新嘅 DRAFT 報價單俾你改</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              改好之後可以正常「發送」。原本嘅報價單同審計 log 會保留以供追溯。
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setReviseConfirmOpen(false)} disabled={revising}>
              取消
            </Button>
            <Button onClick={handleRevise} disabled={revising}>
              {revising ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  建立緊...
                </>
              ) : (
                '建立修訂'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
