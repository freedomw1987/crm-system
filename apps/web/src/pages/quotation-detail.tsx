import { useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
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
  const { t } = useTranslation();
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

  if (isLoading) return <p>{t('quotation.detail.loading')}</p>;
  if (!quotation) return <p>{t('quotation.detail.notFound')}</p>;

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
    if (!window.confirm(t('quotation.detail.deleteConfirm'))) return;
    try {
      await quotationsApi.remove(id);
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      window.history.back();
    } catch (err) {
      window.alert(t('quotation.detail.deleteFailed', { message: (err as Error).message }));
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
      window.alert(t('quotation.detail.reviseFailed', { message: (err as Error).message }));
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
            <h1 className="text-3xl font-bold">{t('quotation.detail.print.title')}</h1>
            <p className="font-mono text-sm text-gray-600 mt-1">
              {quotation.number}
              {/* P2 multi-currency (2026-06-29): show the chosen
                  currency on the printed quote header so the
                  customer knows what they're being billed in
                  before reading the totals block. */}
              {t('quotation.detail.print.currency')}
              <span className="font-semibold">{quotation.currency}</span>
            </p>
          </div>
          <div className="text-right text-sm">
            <p><span className="text-gray-500">{t('quotation.detail.print.issueDate')}</span> {formatDate(quotation.createdAt)}</p>
            {quotation.validUntil && (
              <p><span className="text-gray-500">{t('quotation.detail.print.validUntil')}</span> {formatDate(quotation.validUntil)}</p>
            )}
            <p><span className="text-gray-500">{t('quotation.detail.print.status')}</span> {quotation.status}</p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wide">{t('quotation.detail.print.to')}</p>
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
              <th className="py-2">{t('quotation.detail.table.item')}</th>
              <th className="py-2 text-right">{t('quotation.detail.table.qty')}</th>
              <th className="py-2 text-right">{t('quotation.detail.table.unit')}</th>
              <th className="py-2 text-right">{t('quotation.detail.table.disc')}</th>
              <th className="py-2 text-right">{t('quotation.detail.table.total')}</th>
            </tr>
          </thead>
          <tbody>
            {quotation.items.map((item) => (
              <tr key={item.id ?? item.name} className="border-b last:border-0 align-top">
                <td className="py-2">
                  <div className="font-medium">{item.name}</div>
                  {item.sku && <div className="text-xs text-gray-500">SKU: {item.sku}</div>}
                  <LineItemSnapshotMeta item={item} currency={quotation.currency} print />
                </td>
                <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                <td className="py-2 text-right tabular-nums">{formatCurrency(item.unitPrice, quotation.currency)}</td>
                <td className="py-2 text-right tabular-nums">
                  {item.discount > 0 ? `${item.discount}%` : '—'}
                </td>
                <td className="py-2 text-right tabular-nums font-semibold">{formatCurrency(item.lineTotal, quotation.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-64 text-sm space-y-1">
            <div className="flex justify-between"><span>{t('quotation.totals.subtotal', { currency: quotation.currency })}</span><span className="tabular-nums">{formatCurrency(quotation.subtotal, quotation.currency)}</span></div>
            <div className="flex justify-between"><span>{t('quotation.totals.tax', { rate: quotation.taxRate })}</span><span className="tabular-nums">{formatCurrency(quotation.taxAmount, quotation.currency)}</span></div>
            <div className="flex justify-between border-t pt-2 mt-2 text-base font-bold">
              <span>{t('quotation.totals.total', { currency: quotation.currency })}</span>
              <span className="tabular-nums">{formatCurrency(quotation.total, quotation.currency)}</span>
            </div>
            {/* P2 multi-currency (2026-06-29): print the HKD
                equivalent on the printed quote so management can
                see the HK-denominated figure without flipping back
                to the detail page. Hidden when the chosen currency
                is HKD (redundant). The rate is also shown so the
                reviewer can verify what was applied. */}
            {quotation.currency !== 'HKD' && Number(quotation.totalHKD ?? 0) > 0 && (
              <div className="flex justify-between text-xs text-gray-600 pt-1 mt-1 border-t border-dashed">
                <span>{t('quotation.detail.print.equivalentHKD', { rate: Number(quotation.exchangeRateToHKD ?? 0).toFixed(4) })}</span>
                <span className="tabular-nums">{formatCurrency(quotation.totalHKD ?? 0, 'HKD')}</span>
              </div>
            )}
            {/* P2 multi-currency (2026-06-30): mirror the HKD row for
                MOP. Hidden when the chosen currency is MOP (redundant),
                and hidden on legacy rows where totalMOP == 0 (the
                default before the snapshot migration). */}
            {quotation.currency !== 'MOP' && Number(quotation.totalMOP ?? 0) > 0 && (
              <div className="flex justify-between text-xs text-gray-600 pt-1 mt-1 border-t border-dashed">
                <span>{t('quotation.detail.print.equivalentMOP', { rate: Number(quotation.exchangeRateToMOP ?? 0).toFixed(4) })}</span>
                <span className="tabular-nums">{formatCurrency(quotation.totalMOP ?? 0, 'MOP')}</span>
              </div>
            )}
          </div>
        </div>

        {quotation.notes && (
          <div className="mt-6 text-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{t('quotation.detail.print.notes')}</p>
            <p className="whitespace-pre-wrap">{quotation.notes}</p>
          </div>
        )}

        <div className="mt-8 pt-4 border-t text-xs text-gray-500 flex justify-between print:hidden">
          <Button variant="outline" onClick={() => setSearchParams({})}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('quotation.detail.print.back')}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            {t('quotation.detail.print.print')}
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
                  {t('quotation.detail.aiGenerated')}
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
                    {t('quotation.detail.revisionOf', { number: quotation.parentQuotation.number })}
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
              {quotation.company?.name} · {t('quotation.detail.subtitle', { date: formatDate(quotation.createdAt) })}
              {quotation.title && ` · ${quotation.title}`}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            {t('quotation.detail.print')}
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
            {t('quotation.detail.downloadExcel')}
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
                {t('quotation.detail.edit')}
              </Button>
              <Button size="sm" onClick={() => transition('SENT')} disabled={actionLoading === 'SENT'}>
                <Send className="h-4 w-4 mr-2" />
                {t('quotation.detail.send')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                {t('quotation.detail.delete')}
              </Button>
            </>
          )}
          {isSent && (
            <>
              <Button size="sm" onClick={() => transition('ACCEPTED')} disabled={actionLoading === 'ACCEPTED'}>
                <Check className="h-4 w-4 mr-2" />
                {t('quotation.detail.markAccepted')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => transition('REJECTED')} disabled={actionLoading === 'REJECTED'}>
                <X className="h-4 w-4 mr-2" />
                {t('quotation.detail.markRejected')}
              </Button>
            </>
          )}
          {isAccepted && (
            <Button size="sm" onClick={() => transition('INVOICED')} disabled={actionLoading === 'INVOICED'}>
              {t('quotation.detail.convertToInvoice')}
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
              {t('quotation.detail.createRevision')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('quotation.detail.lineItems')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr className="text-left">
                    <th className="px-4 py-3">{t('quotation.detail.table.item')}</th>
                    <th className="px-4 py-3 text-right">{t('quotation.detail.table.qty')}</th>
                    <th className="px-4 py-3 text-right">{t('quotation.detail.table.unit')}</th>
                    <th className="px-4 py-3 text-right">{t('quotation.detail.table.disc')}</th>
                    <th className="px-4 py-3 text-right">{t('quotation.detail.table.total')}</th>
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
                        <LineItemSnapshotMeta item={item} currency={quotation.currency} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(item.unitPrice, quotation.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {item.discount > 0 ? `${item.discount}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(item.lineTotal, quotation.currency)}
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
                <CardTitle>{t('quotation.detail.notes')}</CardTitle>
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
                  {t('quotation.detail.aiAuditTrail')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">{t('quotation.detail.aiPromptLabel')}</p>
                <p className="text-sm bg-muted p-3 rounded italic">"{quotation.aiPrompt}"</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('quotation.detail.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('quotation.totals.subtotal', { currency: quotation.currency })}</span>
                <span className="tabular-nums">{formatCurrency(quotation.subtotal, quotation.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('quotation.totals.tax', { rate: quotation.taxRate })}</span>
                <span className="tabular-nums">{formatCurrency(quotation.taxAmount, quotation.currency)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold text-base">
                <span>{t('quotation.totals.total', { currency: quotation.currency })}</span>
                <span className="tabular-nums">{formatCurrency(quotation.total, quotation.currency)}</span>
              </div>
              {/* P2 multi-currency (2026-06-29): HKD equivalent under
                  the native total. Reads `totalHKD` from the row's
                  snapshot (not the live config), so a stale viewer
                  still sees the figure that was on the printed quote.
                  Hidden for HKD rows to avoid HKD-on-HKD noise. */}
              {quotation.currency !== 'HKD' && Number(quotation.totalHKD ?? 0) > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground pt-1 mt-1 border-t border-dashed">
                  <span title={t('quotation.detail.print.equivalentTooltip')}>
                    {t('quotation.totals.equivalentHKD', { rate: Number(quotation.exchangeRateToHKD ?? 0).toFixed(4) })}
                  </span>
                  <span className="tabular-nums">{formatCurrency(quotation.totalHKD ?? 0, 'HKD')}</span>
                </div>
              )}
              {/* P2 multi-currency (2026-06-30): mirror the HKD row
                  for MOP. Same snapshot semantics + same legacy-row
                  guard (`totalMOP > 0`). */}
              {quotation.currency !== 'MOP' && Number(quotation.totalMOP ?? 0) > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground pt-1 mt-1 border-t border-dashed">
                  <span title={t('quotation.detail.print.equivalentTooltip')}>
                    {t('quotation.totals.equivalentMOP', { rate: Number(quotation.exchangeRateToMOP ?? 0).toFixed(4) })}
                  </span>
                  <span className="tabular-nums">{formatCurrency(quotation.totalMOP ?? 0, 'MOP')}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-sm space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-3 w-3" />
                <span>{t('quotation.detail.meta.createdBy')}: {quotation.createdBy?.name ?? '—'}</span>
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
                <span>{t('quotation.detail.meta.salesRep')}: {quotation.salesRep?.name ?? quotation.createdBy?.name ?? '—'}</span>
              </div>
              {quotation.validUntil && (
                <p className="text-xs text-muted-foreground">
                  {t('quotation.detail.meta.validUntil')}: {formatDate(quotation.validUntil)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('quotation.detail.meta.createdAt')}: {formatDateTime(quotation.createdAt)}
              </p>
              {quotation.sentAt && (
                <p className="text-xs text-muted-foreground">
                  {t('quotation.detail.meta.sentAt')}: {formatDateTime(quotation.sentAt)}
                </p>
              )}
              {quotation.acceptedAt && (
                <p className="text-xs text-muted-foreground">
                  {t('quotation.detail.meta.acceptedAt')}: {formatDateTime(quotation.acceptedAt)}
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
            <DialogTitle>{t('quotation.detail.editDialogTitle', { number: quotation.number })}</DialogTitle>
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
            <DialogTitle>{t('quotation.detail.reviseDialog.title', { number: quotation.number })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>{t('quotation.detail.reviseDialog.intro')}</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>
                <Trans
                  i18nKey="quotation.detail.reviseDialog.bullet1"
                  values={{ number: quotation.number }}
                  components={{ 1: <span className="font-mono" /> }}
                />
              </li>
              <li>{t('quotation.detail.reviseDialog.bullet2')}</li>
              <li>{t('quotation.detail.reviseDialog.bullet3')}</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              {t('quotation.detail.reviseDialog.outro')}
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setReviseConfirmOpen(false)} disabled={revising}>
              {t('quotation.detail.cancel')}
            </Button>
            <Button onClick={handleRevise} disabled={revising}>
              {revising ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('quotation.detail.reviseDialog.creating')}
                </>
              ) : (
                t('quotation.detail.createRevision')
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuotationStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, 'default' | 'secondary' | 'info' | 'success' | 'warning' | 'destructive'> = {
    DRAFT: 'secondary',
    SENT: 'info',
    VIEWED: 'info',
    ACCEPTED: 'success',
    REJECTED: 'destructive',
    EXPIRED: 'warning',
    INVOICED: 'success',
  };
  return <Badge variant={map[status] ?? 'default'}>{t(`status.quotation.${status}`)}</Badge>;
}
