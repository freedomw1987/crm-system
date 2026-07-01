/**
 * QuotationImportDialog — two-step importer for legacy Quotation Excels.
 *
 * 2026-06-30: closes the UI gap for the AI Excel-import backend
 * (`apps/api/src/lib/excel-import.ts` + `POST /quotations/import/{preview,commit}`).
 *
 * Flow:
 *   1. Upload step: user picks a .xlsx (drag-and-drop or file picker).
 *   2. Preview step: AI extracts a structured `ImportPlan`; we render
 *      it as 4 cards (Company, Deal/Contact/Sales Rep, Line Items, Meta)
 *      with all fields inline-editable. The user can tweak names / prices
 *      / etc. before committing.
 *   3. On confirm: POST to `/quotations/import/commit`; on success
 *      we close + invoke the `onSuccess(quotationId)` callback (the
 *      parent navigates to the detail page).
 *
 * About NEW-vs-REUSED visibility: the backend's `POST /import/preview`
 * returns ONLY the `ImportPlan` (the AI's structured extraction), not
 * the find-or-create `ResolvedPlan` (that is computed by
 * `executeImportPlan` on commit). So in the preview we DON'T render
 * NEW/REUSED badges — that would be guessing. Instead we tell the
 * user in a footnote that the backend will re-resolve on commit and
 * that an exact match by name/SKU is required to reuse an entity.
 *
 * Pattern sources:
 *   - `product-dialog.tsx` for the re-seed-on-open effect and the
 *     inline error display.
 *   - `deal-activity-dialog.tsx` for the hidden-file-input + file
 *     chip + drag-and-drop area.
 *   - `quotations.tsx` `handleAiDraft` for the navigate-on-success
 *     pattern.
 *
 * Reused imports:
 *   - `Button` / `Dialog` / `Card` / `Input` / `Label` / `Badge`
 *     from `@/components/ui/*`.
 *   - `quotationImportApi` + `ImportPlan` type from `@/lib/api`.
 */

import { useEffect, useRef, useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileUp, FileSpreadsheet, Loader2, X, Sparkles, Info,
  AlertCircle, Pencil, Save, ChevronDown, ChevronRight,
  Plus, Trash2, Maximize2, Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label, Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  quotationImportApi, manDayRolesApi, ApiError,
  type ImportPlan, type ManDayRole,
} from '@/lib/api';

type Step = 'upload' | 'preview' | 'submitting';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called after a successful commit. The parent typically navigates
   *  to `/quotations/${quotationId}`. */
  onSuccess?: (quotationId: string) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function QuotationImportDialog({ open, onOpenChange, onSuccess }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 2026-07-01 (US-IMPORT-MD): per-SERVICE-row expandable man-day
  // editor. Each entry is a row index → boolean (open/closed).
  // Default closed so the Preview table doesn't feel noisy until
  // the user actively opens a row.
  const [expandedManDay, setExpandedManDay] = useState<Record<number, boolean>>({});

  // 2026-07-01 (US-PREVIEW-FS): user-toggleable fullscreen mode for the
  // preview dialog. Quotation Excel previews can span hundreds of
  // line items + multi-paragraph SOW descriptions and quickly
  // overflow a 3xl-width dialog. The fullscreen state stretches the
  // DialogContent to the viewport edges (no max-width, no rounded
  // corners, no max-height). State resets to `false` whenever the
  // dialog opens so a previous fullscreen session doesn't leak
  // into the next open.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (open) setIsFullscreen(false);
  }, [open]);

  // Fetch the ManDayRole catalogue (active rows only) for the
  // editor's role dropdown. 5-min stale time matches the existing
  // ManDayEditor component (apps/web/src/components/man-day-editor.tsx);
  // when admins add a new role in /settings/man-day while the
  // import dialog is open, the dropdown won't pick it up until the
  // user re-opens the dialog or the cache expires. Acceptable
  // because role creation is a rare admin action.
  const { data: manDayRoles = [] } = useQuery<ManDayRole[]>({
    queryKey: ['man-day-roles-active'],
    queryFn: () => manDayRolesApi.list(),
    select: (rs) => rs.filter((r) => r.isActive),
    staleTime: 5 * 60_000,
  });

  // Re-seed on open (mirrors ProductDialog's pattern) so a previous
  // half-completed import doesn't leak into the next session.
  useEffect(() => {
    if (open) {
      setStep('upload');
      setFile(null);
      setPlan(null);
      setError(null);
    }
  }, [open]);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setError('只支援 .xlsx 檔案');
      return;
    }
    setError(null);
    setFile(f);
    // Auto-advance to preview so the user only needs to confirm.
    void runPreview(f);
  }

  async function runPreview(f: File) {
    setStep('preview');
    setError(null);
    try {
      const { plan: extracted } = await quotationImportApi.preview(f);
      setPlan(extracted);
    } catch (e) {
      const msg = e instanceof ApiError
        ? (e.body && typeof e.body === 'object' && 'error' in e.body
          ? (e.body as { error: string }).error
          : e.message)
        : e instanceof Error ? e.message : '預覽失敗';
      setError(msg);
      setStep('upload');
    }
  }

  async function commit() {
    if (!plan) return;
    setStep('submitting');
    setError(null);
    try {
      // 2026-07-01 (US-IMPORT-NOMD): before commit, strip any
      // manDaySnapshot rows from lines that the "no man-day"
      // heuristic flagged (Barco-MA, Barco-LIC, or maintenance
      // fee by name). Even though we hide the toggle button in
      // the preview, the LLM may have pre-populated empty /
      // malformed rows when it processed the source Excel, and
      // the backend's zod schema rejects non-numeric dayRate /
      // costRate with "Expected number, received string".
      // Stripping here makes the commit robust even when the LLM
      // emits garbage for these SKU classes.
      const sanitisedPlan: ImportPlan = {
        ...plan,
        lineItems: plan.lineItems.map((li) =>
          isNoManDayLine(li) ? { ...li, manDaySnapshot: null } : li,
        ),
      };
      const { newQuotationId } = await quotationImportApi.commit(sanitisedPlan);
      onOpenChange(false);
      onSuccess?.(newQuotationId);
    } catch (e) {
      const msg = e instanceof ApiError
        ? (e.body && typeof e.body === 'object' && 'error' in e.body
          ? (e.body as { error: string }).error
          : e.message)
        : e instanceof Error ? e.message : '送出失敗';
      setError(msg);
      setStep('preview');
    }
  }

  // ----- step renderers ------------------------------------------

  function renderUpload() {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          上傳舊的 Quotation Excel 檔,AI 會自動提取客戶、產品、服務、報價項目。
          <br />
          已存在的客戶/產品/服務會自動關聯;找不到的會建立新記錄。
        </p>
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = e.dataTransfer.files?.[0];
            pickFile(dropped);
          }}
          className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 text-center cursor-pointer hover:bg-muted/40 transition-colors"
        >
          <FileUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">點擊此處選擇檔案,或拖曳檔案至此</p>
          <p className="text-xs text-muted-foreground mt-1">只支援 .xlsx (上限 50MB)</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    );
  }

  function renderPreview() {
    if (!plan) {
      // First paint after `setStep('preview')` and before plan resolves
      return (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>AI 想緊點抽取...</span>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {file && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted px-3 py-2 rounded">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span className="truncate">{file.name}</span>
            <span>·</span>
            <span>{formatBytes(file.size)}</span>
          </div>
        )}

        {/* ----- Company ----------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                公司 (Company)
              </span>
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="imp-co-name">名稱</Label>
                <Input
                  id="imp-co-name"
                  value={plan.company.name}
                  onChange={(e) => setPlan({ ...plan, company: { ...plan.company, name: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-co-region">地區</Label>
                <Select
                  id="imp-co-region"
                  value={plan.company.regionCode ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    company: { ...plan.company, regionCode: (e.target.value || null) as 'HK' | 'MO' | 'CN' | 'OTHER' | null },
                  })}
                >
                  <option value="">— 未指定 —</option>
                  <option value="HK">HK 香港</option>
                  <option value="MO">MO 澳門</option>
                  <option value="CN">CN 中國</option>
                  <option value="OTHER">OTHER 其他</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-co-tax">統編 / Tax ID</Label>
                <Input
                  id="imp-co-tax"
                  value={plan.company.taxId ?? ''}
                  onChange={(e) => setPlan({ ...plan, company: { ...plan.company, taxId: e.target.value || null } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-co-industry">行業</Label>
                <Input
                  id="imp-co-industry"
                  value={plan.company.industry ?? ''}
                  onChange={(e) => setPlan({ ...plan, company: { ...plan.company, industry: e.target.value || null } })}
                />
              </div>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">聯絡人資料 (可選)</summary>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="imp-co-person">姓名</Label>
                  <Input
                    id="imp-co-person"
                    value={plan.company.contactPerson ?? ''}
                    onChange={(e) => setPlan({ ...plan, company: { ...plan.company, contactPerson: e.target.value || null } })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="imp-co-email">Email</Label>
                  <Input
                    id="imp-co-email"
                    type="email"
                    value={plan.company.contactEmail ?? ''}
                    onChange={(e) => setPlan({ ...plan, company: { ...plan.company, contactEmail: e.target.value || null } })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="imp-co-phone">電話</Label>
                  <Input
                    id="imp-co-phone"
                    value={plan.company.contactPhone ?? ''}
                    onChange={(e) => setPlan({ ...plan, company: { ...plan.company, contactPhone: e.target.value || null } })}
                  />
                </div>
              </div>
            </details>
          </CardContent>
        </Card>

        {/* ----- Deal + Contact + Sales Rep ----------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">商機 / 聯絡人 / 銷售員 (可選)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="imp-deal-title">Deal 名稱</Label>
                <Input
                  id="imp-deal-title"
                  value={plan.deal?.title ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    deal: e.target.value
                      ? { ...(plan.deal ?? { title: '' }), title: e.target.value }
                      : null,
                  })}
                  placeholder="例:Acme 升級項目"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-deal-owner">銷售員 (Sales Rep)</Label>
                <Input
                  id="imp-deal-owner"
                  value={plan.deal?.ownerName ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    deal: plan.deal
                      ? { ...plan.deal, ownerName: e.target.value || null }
                      : null,
                  })}
                  placeholder="依姓名自動配對現有 User"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-deal-value">Deal 估值</Label>
                <Input
                  id="imp-deal-value"
                  type="number"
                  value={plan.deal?.value ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    deal: plan.deal
                      ? { ...plan.deal, value: e.target.value === '' ? null : Number(e.target.value) }
                      : null,
                  })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-contact-name">聯絡人姓名</Label>
                <Input
                  id="imp-contact-name"
                  value={plan.contact?.name ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    contact: e.target.value
                      ? { name: e.target.value, email: plan.contact?.email ?? null, phone: plan.contact?.phone ?? null }
                      : null,
                  })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-contact-email">聯絡人 Email</Label>
                <Input
                  id="imp-contact-email"
                  type="email"
                  value={plan.contact?.email ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    contact: plan.contact
                      ? { ...plan.contact, email: e.target.value || null }
                      : null,
                  })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-contact-phone">聯絡人電話</Label>
                <Input
                  id="imp-contact-phone"
                  value={plan.contact?.phone ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    contact: plan.contact
                      ? { ...plan.contact, phone: e.target.value || null }
                      : null,
                  })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ----- Line Items --------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              報價項目 ({plan.lineItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">類型</th>
                    <th className="px-3 py-2 font-medium">名稱</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium text-right">數量</th>
                    <th className="px-3 py-2 font-medium text-right">單價</th>
                    <th className="px-3 py-2 font-medium text-right">折扣%</th>
                    <th className="px-3 py-2 font-medium text-right">小計</th>
                    {/* 2026-07-01 (US-IMPORT-MD): per-row toggle for the
                        inline Man-day editor. Empty cell for PRODUCT
                        rows (they don't have a man-day breakdown). */}
                    <th className="px-3 py-2 font-medium">人天</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.lineItems.map((li, idx) => {
                    const lineTotal = li.quantity * li.unitPrice * (1 - (li.discount ?? 0) / 100);
                    const mdCount = li.manDaySnapshot?.length ?? 0;
                    const isOpen = !!expandedManDay[idx];
                    return (
                      <Fragment key={idx}>
                        <tr className="border-t">
                          <td className="px-3 py-2">
                            <Badge variant={li.type === 'PRODUCT' ? 'info' : 'secondary'} className="text-[10px]">
                              {li.type}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={li.name}
                              onChange={(e) => updateLineItem(idx, { name: e.target.value })}
                              className="h-8"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={li.sku ?? ''}
                              onChange={(e) => updateLineItem(idx, { sku: e.target.value || null })}
                              className="h-8 w-28"
                              placeholder={li.type === 'PRODUCT' ? 'sku' : '—'}
                              disabled={li.type === 'SERVICE'}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              value={li.quantity}
                              onChange={(e) => updateLineItem(idx, { quantity: Number(e.target.value) })}
                              className="h-8 w-20 text-right"
                              min={0}
                              step="0.01"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              value={li.unitPrice}
                              onChange={(e) => updateLineItem(idx, { unitPrice: Number(e.target.value) })}
                              className="h-8 w-24 text-right"
                              min={0}
                              step="0.01"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              value={li.discount ?? 0}
                              onChange={(e) => updateLineItem(idx, { discount: Number(e.target.value) })}
                              className="h-8 w-16 text-right"
                              min={0}
                              max={100}
                              step="1"
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            {lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {li.type === 'SERVICE' && !isNoManDayLine(li) ? (
                              <button
                                type="button"
                                onClick={() => setExpandedManDay((e) => ({ ...e, [idx]: !e[idx] }))}
                                className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
                              >
                                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                {mdCount === 0 ? '設定' : `${mdCount} 行`}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground/50" title={
                                li.type === 'SERVICE'
                                  ? '此行不需要設定人天 (維護費用 / Licence)'
                                  : undefined
                              }>
                                {li.type === 'SERVICE' ? '不需要' : '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                        {li.type === 'SERVICE' && !isNoManDayLine(li) && isOpen && (
                          <tr className="border-t bg-muted/20">
                            <td colSpan={8} className="px-3 py-3">
                              <ImportManDayEditor
                                rows={li.manDaySnapshot ?? []}
                                onChange={(rows) => updateLineItem(idx, { manDaySnapshot: rows })}
                                catalogue={manDayRoles}
                                defaultDayRate={li.unitPrice}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  <tr className="border-t bg-muted/30 font-medium">
                    <td colSpan={7} className="px-3 py-2 text-right">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {plan.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice * (1 - (li.discount ?? 0) / 100), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ----- Meta --------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">報價單資料</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="imp-title">標題</Label>
                <Input
                  id="imp-title"
                  value={plan.meta.title}
                  onChange={(e) => setPlan({ ...plan, meta: { ...plan.meta, title: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-currency">出單貨幣</Label>
                <Select
                  id="imp-currency"
                  value={plan.meta.currency}
                  onChange={(e) => setPlan({ ...plan, meta: { ...plan.meta, currency: e.target.value as 'RMB' | 'HKD' | 'MOP' } })}
                >
                  <option value="RMB">人民幣 (RMB)</option>
                  <option value="HKD">港幣 (HKD)</option>
                  <option value="MOP">澳門幣 (MOP)</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-taxrate">稅率 %</Label>
                <Input
                  id="imp-taxrate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={plan.meta.taxRate}
                  onChange={(e) => setPlan({ ...plan, meta: { ...plan.meta, taxRate: Number(e.target.value) } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-issuedate">報價日期</Label>
                <Input
                  id="imp-issuedate"
                  type="date"
                  value={plan.meta.issueDate?.slice(0, 10) ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    meta: { ...plan.meta, issueDate: e.target.value ? new Date(e.target.value).toISOString() : null },
                  })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-validuntil">有效期至</Label>
                <Input
                  id="imp-validuntil"
                  type="date"
                  value={plan.meta.validUntil?.slice(0, 10) ?? ''}
                  onChange={(e) => setPlan({
                    ...plan,
                    meta: { ...plan.meta, validUntil: e.target.value ? new Date(e.target.value).toISOString() : null },
                  })}
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="imp-notes">備註</Label>
                <Textarea
                  id="imp-notes"
                  value={plan.meta.notes ?? ''}
                  onChange={(e) => setPlan({ ...plan, meta: { ...plan.meta, notes: e.target.value || null } })}
                  rows={2}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </p>
        )}

        {/* Resolve note — preview only shows the AI's structured
            extraction; the actual NEW-vs-REUSED resolution is computed
            server-side on commit. The backend matches by exact name
            (case-insensitive) and SKU; if a user edits a name here to
            avoid colliding with an existing record, that's how they
            force a "new" creation. */}
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>
            送出後 backend 會再行一次 find-or-create — 客戶/Deal/聯絡人/產品/服務按名稱(不分大小寫)+ SKU 自動配對既有記錄;
            無法配對時將建立新記錄。所有新建的 entity 都會寫入 audit log。
          </span>
        </p>
      </div>
    );
  }

  function updateLineItem(idx: number, patch: Partial<ImportPlan['lineItems'][number]>) {
    if (!plan) return;
    const next = [...plan.lineItems];
    next[idx] = { ...next[idx]!, ...patch };
    setPlan({ ...plan, lineItems: next });
  }

  // 2026-07-01 (US-IMPORT-NOMD): identify SERVICE line items
  // whose SKU / name indicates they don't carry a man-day
  // breakdown. In the Barco Excel template:
  //   - `Barco-MA*` SKU → maintenance service fee (already
  //     priced as a flat unit price; no 人天 breakdown)
  //   - `Barco-LIC*` SKU → software licence (a product-grade
  //     line that happens to be tagged SERVICE in the source
  //     Excel; cost = unit price, no 人天 breakdown)
  //   - `維護費用` / `維修費用` / `Maintenance Fee` / `Maintenance
  //     Service` lines → flat-rate maintenance line items that
  //     were created by the Quotation builder's "+ 維護費用"
  //     button (admin-set percentage of subtotal × qty 1).
  // For these lines we hide the inline Man-day editor entirely
  // — the user wouldn't fill in any man-day rows, and if the
  // LLM extracted empty / malformed values we'd silently keep
  // them around (which is what triggered the "Expected number,
  // received string" zod failure on commit).
  function isNoManDayLine(li: ImportPlan['lineItems'][number]): boolean {
    const sku = (li.sku ?? '').trim().toUpperCase();
    const name = (li.name ?? '').trim();
    if (sku.startsWith('BARCO-MA') || sku.startsWith('BARCO-LIC')) return true;
    if (/(維護費用|維修費用|Maintenance\s+(Fee|Service))/i.test(name)) return true;
    return false;
  }

  // ----- footer / submit ----------------------------------------

  const submitting = step === 'submitting';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      {/* 2026-07-01 (US-PREVIEW-FS): fullscreen toggle. In normal mode
          we keep the original 3xl / 90vh framing; in fullscreen mode
          we stretch to the viewport, drop the rounded corners, and
          bump the padding so the dense preview tables get more
          breathing room. The switch is purely cosmetic — the inner
          section renderers (cards, tables, inputs) don't care. */}
      <DialogContent
        className={
          isFullscreen
            ? 'w-screen h-screen max-w-none rounded-none p-6 sm:p-8 overflow-y-auto'
            : 'max-w-3xl max-h-[90vh] overflow-y-auto'
        }
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-12">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Import Quotation from Excel
          </DialogTitle>
          {/* Fullscreen toggle positioned to the LEFT of the
              built-in Radix close button so both are reachable.
              Wrapped in a relative-positioned container so the
              absolute positioning doesn't reflow the title row. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-12 top-4 h-7 w-7"
            onClick={() => setIsFullscreen((f) => !f)}
            aria-label={isFullscreen ? '退出全屏幕' : '切換到全屏幕'}
            title={isFullscreen ? '退出全屏幕' : '切換到全屏幕'}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </DialogHeader>

        {step === 'submitting' ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <p className="text-sm text-muted-foreground">AI 創建緊 Quotation ...</p>
          </div>
        ) : step === 'upload' ? (
          renderUpload()
        ) : (
          renderPreview()
        )}

        <DialogFooter className="gap-2">
          {step === 'upload' && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button
                variant="ghost"
                onClick={() => { setStep('upload'); setFile(null); setPlan(null); setError(null); }}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                重選檔案
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={commit} disabled={!plan}>
                <Save className="h-4 w-4 mr-1" />
                確認建立
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 2026-07-01 (US-IMPORT-MD): inline Man-day Breakdown editor for the
// AI Excel import Preview modal. Not extracted to a shared file
// because it's tightly coupled to ImportPlan's `manDaySnapshot` wire
// format and we want the cost/role pickers + row add/remove logic
// in the same file as the dialog so future edits to the wire format
// stay in one place.
//
// Behaviour mirrors the catalogue-side ManDayEditor
// (`apps/web/src/components/man-day-editor.tsx`) but with two
// differences suited to the import flow:
//   1. The role dropdown is sourced from the live `manDayRoles` query
//      passed in as a prop (not a per-instance useQuery) so the
//      parent controls the cache key + stale time.
//   2. The default `dayRate` for newly-added rows comes from the
//      parent line's `unitPrice` (a sensible fallback for free-form
//      rows when the LLM didn't extract a per-day rate).
// ---------------------------------------------------------------------------
type ImportManDayRow = NonNullable<NonNullable<ImportPlan['lineItems'][number]['manDaySnapshot']>[number]>;

function ImportManDayEditor({
  rows,
  onChange,
  catalogue,
  defaultDayRate,
}: {
  rows: ImportManDayRow[];
  onChange: (rows: ImportManDayRow[]) => void;
  catalogue: ManDayRole[];
  defaultDayRate: number;
}) {
  function addRow() {
    onChange([
      ...rows,
      {
        role: '',
        manDayRoleId: null,
        dayRate: defaultDayRate,
        days: 1,
        costRate: 0,
      },
    ]);
  }
  function updateRow(i: number, patch: Partial<ImportManDayRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  const sellSum = rows.reduce((s, r) => s + (Number(r.dayRate) || 0) * (Number(r.days) || 0), 0);
  const costSum = rows.reduce((s, r) => s + (Number(r.costRate) || 0) * (Number(r.days) || 0), 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          人天結構 (SOW breakdown) — 提交後會 snapshot 落 QuotationItem;
          新 service 會和時 create ServiceManDay rows 入 catalogue
        </span>
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus className="h-3 w-3 mr-1" /> 加一行
        </Button>
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          尚未設定。點擊「加一行」加入第一個 role breakdown(可留空,提交後此 SERVICE 的
          costSnapshot = 0、lineGpPercent = 100%)。
        </p>
      )}
      {rows.map((row, i) => (
        // grid-cols-12 keeps the row compact; mirrors the
        // catalogue-side ManDayEditor layout for visual consistency.
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <Select
            value={row.manDayRoleId ?? ''}
            onChange={(e) => {
              const roleId = e.target.value || null;
              const cat = catalogue.find((r) => r.id === roleId);
              updateRow(i, {
                manDayRoleId: roleId,
                role: cat?.name ?? row.role,
                dayRate: cat?.price ?? row.dayRate,
                costRate: cat?.cost ?? row.costRate,
              });
            }}
            className="col-span-4 h-8 text-xs"
          >
            <option value="">— 自訂(自由填)—</option>
            {catalogue.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (¥{Number(r.price).toLocaleString()}/day)
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={0}
            value={row.dayRate}
            onChange={(e) => updateRow(i, { dayRate: Number(e.target.value) })}
            className="col-span-2 h-8 text-right"
            placeholder="day rate"
            title="Day rate (sell)"
          />
          <Input
            type="number"
            min={0}
            step={0.5}
            value={row.days}
            onChange={(e) => updateRow(i, { days: Number(e.target.value) })}
            className="col-span-2 h-8 text-right"
            placeholder="days"
            title="Man-days"
          />
          <Input
            type="number"
            min={0}
            value={row.costRate ?? 0}
            onChange={(e) => updateRow(i, { costRate: Number(e.target.value) })}
            className="col-span-2 h-8 text-right"
            placeholder="cost/day"
            title="Cost per man-day (drives costSnapshot / GP%)"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => removeRow(i)}
            className="col-span-2 h-8"
            disabled={rows.length === 1}
            title="移除此行"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {rows.length > 0 && (
        <div className="text-xs text-muted-foreground text-right pt-1 border-t">
          Σ sell: <span className="font-mono">{sellSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> ·{' '}
          Σ cost: <span className="font-mono">{costSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> ·{' '}
          GP% = <span className="font-mono">
            {sellSum > 0 ? ((1 - costSum / sellSum) * 100).toFixed(1) : '100.0'}%
          </span>
        </div>
      )}
    </div>
  );
}