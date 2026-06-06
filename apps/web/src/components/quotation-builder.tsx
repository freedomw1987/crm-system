/**
 * QuotationBuilder — Day 8 enhanced
 *
 * - Picks a company + optional deal (link quotation to pipeline opportunity)
 * - Each line is polymorphic: Product OR Service
 *   - Autocomplete combobox for picking an existing Product or Service
 *   - Quick-create buttons to add a new Product or Service on the fly
 *   - Service items snapshot manDay breakdown at the time of creation
 * - Live subtotal / tax / total recompute as you type
 * - Add / remove line items freely
 * - Saves via quotationsApi.create / .update
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Trash2, X, Package, Briefcase, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  productsApi, servicesApi, quotationsApi,
  type Product, type Service, type ServiceManDay,
  type Quotation, type QuotationItem, type Deal,
} from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { QuickCreateServiceDialog } from './quick-create-service-dialog';
import { ProductDialog } from './product-dialog';
import { CompanyAutocomplete } from './company-autocomplete';

interface DraftLine {
  key: string;
  itemType: 'PRODUCT' | 'SERVICE';
  // PRODUCT
  productId?: string;
  sku?: string;
  // SERVICE
  serviceId?: string;
  manDaySnapshot?: Array<{ role: string; dayRate: number; days: number; costRate?: number; subtotal: number }>;
  // common
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount: number;     // percent
  itemId?: string;      // set when editing an existing item
  /**
   * Day N: GP fields carried over from the server. Populated in EDIT
   * mode (the items in `existing.items` already have lineGp/lineGpPercent
   * computed by recalcQuotationAndItems). In CREATE mode these stay
   * undefined because we don't have the per-line costRate client-side;
   * the builder shows "—" for service lines and 100% for product lines
   * in the live preview, and the server fills in the real values on
   * POST. See /api/src/routes/quotation.ts:40 (gpOf) for the formula.
   */
  lineGp?: number;
  lineGpPercent?: number;
}

interface QuotationBuilderProps {
  existing?: Quotation;
  /** Optional preset dealId (when builder is opened from a deal detail page). */
  initialDealId?: string;
  /**
   * Optional preset companyId (when builder is opened from a company
   * detail page's "+ 新增 Quotation" shortcut). Mirrors the initialDealId
   * pattern so Sales never has to re-pick the company they came from.
   */
  initialCompanyId?: string;
  /**
   * Day N: alias for `initialCompanyId` for clarity at call-sites
   * (e.g. inline modal from a Company card — "default" reads better than
   * "initial" when the dialog is opened pre-populated). If both are
   * provided, `defaultCompanyId` wins.
   */
  defaultCompanyId?: string;
  /** Day N: alias for `initialDealId` — see defaultCompanyId. */
  defaultDealId?: string;
  onSaved: (q: Quotation) => void;
  onCancel: () => void;
}

function emptyLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    itemType: 'PRODUCT',
    quantity: 1,
    unitPrice: 0,
    discount: 0,
    name: '',
  };
}

function linesFromQuotation(q?: Quotation): DraftLine[] {
  if (!q?.items?.length) return [emptyLine()];
  return q.items.map((it: QuotationItem) => ({
    key: it.id ?? crypto.randomUUID(),
    itemId: it.id,
    itemType: it.itemType,
    productId: it.productId ?? undefined,
    serviceId: it.serviceId ?? undefined,
    sku: it.sku ?? undefined,
    name: it.name,
    description: it.description ?? undefined,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unitPrice),
    discount: Number(it.discount ?? 0),
    manDaySnapshot: it.manDaySnapshot ?? undefined,
    lineGp: it.lineGp != null ? Number(it.lineGp) : undefined,
    lineGpPercent: it.lineGpPercent != null ? Number(it.lineGpPercent) : undefined,
  }));
}

function lineTotal(line: DraftLine): number {
  const qty = Number(line.quantity) || 0;
  const price = Number(line.unitPrice) || 0;
  const disc = Number(line.discount) || 0;
  return qty * price * (1 - disc / 100);
}

export function QuotationBuilder({
  existing, initialDealId, initialCompanyId, defaultCompanyId, defaultDealId, onSaved, onCancel,
}: QuotationBuilderProps) {
  const isEdit = !!existing;

  // For create mode, prefer `defaultCompanyId` (the newer inline-modal
  // alias) over `initialCompanyId` (the legacy /quotations?companyId=
  // route alias) over the edit-mode company field. Same precedence
  // pattern for dealId below. The values seed the state below; the user
  // can still change either before saving.
  const seedCompanyId = defaultCompanyId ?? initialCompanyId ?? existing?.companyId ?? '';
  const seedDealId = defaultDealId ?? initialDealId ?? '';
  const [companyId, setCompanyId] = useState<string>(seedCompanyId);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [taxRate, setTaxRate] = useState<number>(existing ? Number(existing.taxRate) : 0);
  const [validUntil, setValidUntil] = useState<string>(
    existing?.validUntil ? existing.validUntil.slice(0, 10) : ''
  );
  const [dealId, setDealId] = useState<string>(seedDealId);
  const [lines, setLines] = useState<DraftLine[]>(linesFromQuotation(existing));

  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [companyDeals, setCompanyDeals] = useState<Deal[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load products + services for dropdowns. Companies are loaded by
  // <CompanyAutocomplete> on demand (it self-fetches when no `companies`
  // prop is passed), so we don't double-fetch here.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, s] = await Promise.all([
          productsApi.list({ limit: 200 }),
          servicesApi.list({ limit: 200 }),
        ]);
        if (alive) {
          setProducts(p);
          setServices(s);
        }
      } catch (err) {
        if (alive) setError(`載入 dropdown 失敗: ${(err as Error).message}`);
      } finally {
        if (alive) setLoadingRefs(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Load deals whenever companyId changes (for deal link dropdown)
  useEffect(() => {
    if (!companyId) { setCompanyDeals([]); return; }
    let alive = true;
    (async () => {
      try {
        const token = localStorage.getItem('crm:token');
        const r = await fetch(`/api/deals?companyId=${companyId}&limit=50`, {
          headers: { Authorization: `Bearer ${token ?? ''}` },
        });
        const d = await r.json();
        if (alive) setCompanyDeals(Array.isArray(d) ? d : d.items ?? []);
      } catch {
        if (alive) setCompanyDeals([]);
      }
    })();
    return () => { alive = false; };
  }, [companyId]);

  // Live totals
  const subtotal = useMemo(() => lines.reduce((s, l) => s + lineTotal(l), 0), [lines]);
  const taxAmount = subtotal * (Number(taxRate) / 100);
  const total = subtotal + taxAmount;
  // Total GP = sum of known lineGp values (from edit mode carry-over),
  // plus live-derived lineTotal for product lines (PRODUCT GP is 100% of
  // lineTotal per the backend's gpOf() formula). For SERVICE lines in
  // CREATE mode we derive from the manDaySnapshot we just snapshotted
  // when the service was picked: per-line cost = sum(costRate × days)
  // (a "per line" cost because quantity already represents man-day
  // units for service lines). This mirrors the backend's
  // costPerManDayFromSnapshot() helper — see apps/api/src/routes/quotation.ts.
  const { totalGp, totalGpUnknownService } = useMemo(() => {
    let gp = 0;
    let unknownService = 0;
    for (const l of lines) {
      if (l.lineGp != null) { gp += l.lineGp; continue; }
      if (l.itemType === 'PRODUCT') { gp += lineTotal(l); continue; }
      // SERVICE line in CREATE mode (or after a snapshot rebuild):
      // derive from manDaySnapshot if it has costRate, else fall back
      // to "—" (the user will see the real value after the server's
      // recalcQuotationAndItems runs and onSaved returns the full row).
      const snap = l.manDaySnapshot;
      if (snap && snap.length > 0 && snap.some((m) => m.costRate != null && Number(m.costRate) > 0)) {
        const costPerUnit = snap.reduce((s, m) => s + Number(m.costRate ?? 0) * Number(m.days), 0);
        const lineSell = lineTotal(l);
        gp += lineSell - costPerUnit * Number(l.quantity);
      } else {
        unknownService += 1;
      }
    }
    return { totalGp: gp, totalGpUnknownService: unknownService };
  }, [lines]);
  const totalGpPct = subtotal > 0 ? (totalGp / subtotal) * 100 : 0;

  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function switchItemType(idx: number, newType: 'PRODUCT' | 'SERVICE') {
    setLines((prev) => prev.map((l, i) =>
      i === idx ? { ...l, itemType: newType, productId: undefined, serviceId: undefined, manDaySnapshot: undefined } : l
    ));
  }

  function applyProduct(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateLine(idx, { productId: undefined, sku: undefined });
      return;
    }
    updateLine(idx, {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description ?? undefined,
      unitPrice: Number(product.unitPrice),
      quantity: 1,
    });
  }

  function applyService(idx: number, serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    if (!service) {
      updateLine(idx, { serviceId: undefined, manDaySnapshot: undefined });
      return;
    }
    // Build the man-day snapshot at apply time so the quotation captures the
    // SOW breakdown even if the service is later edited. Pass through
    // `costRate` from the service's manDayLines so the builder's live
    // GP% preview has the cost data it needs without an extra roundtrip
    // — backend's recalcQuotationAndItems will also use this snapshot.
    const snapshot = (service.manDays ?? []).map((m: ServiceManDay) => ({
      role: m.role,
      dayRate: Number(m.dayRate),
      days: Number(m.days),
      costRate: Number(m.costRate ?? 0),
      subtotal: Number(m.subtotal ?? Number(m.dayRate) * Number(m.days)),
    }));
    updateLine(idx, {
      serviceId: service.id,
      name: service.name,
      description: service.description ?? undefined,
      unitPrice: Number(service.unitPrice),
      quantity: 1,
      manDaySnapshot: snapshot,
    });
  }

  function addLine(type: 'PRODUCT' | 'SERVICE' = 'PRODUCT') {
    setLines((prev) => [...prev, { ...emptyLine(), itemType: type }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function validate(): string | null {
    if (!companyId) return '揀個客戶先';
    const validLines = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0 && Number(l.unitPrice) >= 0);
    if (validLines.length === 0) return '至少要有一個 line item';
    return null;
  }

  async function handleSave() {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      const validLines = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0);
      if (isEdit && existing) {
        // 1. update header
        let q = await quotationsApi.update(existing.id, {
          title: title || undefined,
          notes: notes || undefined,
          taxRate,
          validUntil: validUntil || undefined,
        });
        // 2. sync items: delete removed, add new, update existing
        const originalIds = new Set((existing.items ?? []).map((it) => it.id).filter(Boolean) as string[]);
        const currentIds = new Set(validLines.map((l) => l.itemId).filter(Boolean) as string[]);
        const toDelete = [...originalIds].filter((id) => !currentIds.has(id));
        const toAdd = validLines.filter((l) => !l.itemId);
        const toUpdate = validLines.filter((l) => l.itemId && originalIds.has(l.itemId));
        await Promise.all([
          ...toDelete.map((itemId) => quotationsApi.removeItem(existing.id, itemId)),
          ...toAdd.map((l) => quotationsApi.addItem(existing.id, {
            itemType: l.itemType,
            productId: l.productId,
            serviceId: l.serviceId,
            sku: l.sku,
            name: l.name,
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            discount: Number(l.discount) || 0,
            manDaySnapshot: l.manDaySnapshot,
          })),
          ...toUpdate.map((l) => quotationsApi.updateItem(existing.id, l.itemId!, {
            itemType: l.itemType,
            productId: l.productId,
            serviceId: l.serviceId,
            sku: l.sku,
            name: l.name,
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            discount: Number(l.discount) || 0,
          })),
        ]);
        q = await quotationsApi.get(existing.id);
        onSaved(q);
      } else {
        const created = await quotationsApi.create({
          companyId,
          dealId: dealId || undefined,
          title: title || undefined,
          notes: notes || undefined,
          taxRate,
          validUntil: validUntil || undefined,
          items: validLines.map((l) => ({
            itemType: l.itemType,
            productId: l.productId,
            serviceId: l.serviceId,
            sku: l.sku,
            name: l.name,
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            discount: Number(l.discount) || 0,
            manDaySnapshot: l.manDaySnapshot,
          })),
        });
        onSaved(created);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loadingRefs) {
    return <p className="text-sm text-muted-foreground p-4">載入公司 / 產品 / 服務...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="company">客戶 *</Label>
          <CompanyAutocomplete
            value={companyId}
            onChange={setCompanyId}
            label=""
            placeholder="搜尋客戶名稱..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal">關聯 Deal (可選)</Label>
          <Select id="deal" value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={!companyId}>
            <option value="">-- 無 --</option>
            {companyDeals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · {formatCurrency(d.value)} · {d.stage?.name ?? d.status}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="title">標題</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: Q2 系統升級報價" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="valid">有效至</Label>
          <Input id="valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="tax">稅率 (%)</Label>
          <Input
            id="tax"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={taxRate}
            onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      {/* Line items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Line Items</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => addLine('PRODUCT')}>
              <Plus className="h-3 w-3 mr-1" /> 加 Product
            </Button>
            <Button size="sm" variant="outline" onClick={() => addLine('SERVICE')}>
              <Plus className="h-3 w-3 mr-1" /> 加 Service
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {lines.map((line, idx) => (
            <LineItemRow
              key={line.key}
              line={line}
              products={products}
              services={services}
              onSwitchType={(t) => switchItemType(idx, t)}
              onApplyProduct={(id) => applyProduct(idx, id)}
              onApplyService={(id) => applyService(idx, id)}
              onChange={(patch) => updateLine(idx, patch)}
              onRemove={() => removeLine(idx)}
              canRemove={lines.length > 1}
              onCreateProduct={(p) => {
                setProducts((prev) => [p, ...prev]);
              }}
              onCreateService={(s) => {
                setServices((prev) => [s, ...prev]);
              }}
            />
          ))}
        </CardContent>
      </Card>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">備註</Label>
        <Textarea
          id="notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="額外條款、安裝時程、聯絡人等..."
        />
      </div>

      {/* Totals */}
      <Card>
        <CardContent className="p-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax ({taxRate}%)</span>
            <span className="tabular-nums">{formatCurrency(taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 mt-2 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
          {/* Total GP summary — emerald so it stands out from cost rows.
              Service lines in CREATE mode don't contribute (costRate is
              server-side only), so the % is a partial best-effort
              estimate; we surface a hint when that's the case. */}
          <div className="flex justify-between text-sm pt-1 mt-1 border-t">
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              Total GP
              {totalGpUnknownService > 0 && (
                <span
                  className="ml-1 text-[10px] text-muted-foreground font-normal"
                  title="Service line cost 未知 (server 才有),儲存後先見到實際 GP"
                >
                  (未計 {totalGpUnknownService} 條 service)
                </span>
              )}
            </span>
            <span className="tabular-nums text-emerald-700 dark:text-emerald-400 font-medium">
              {formatCurrency(totalGp)} ({totalGpPct.toFixed(0)}%)
            </span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              儲存中...
            </>
          ) : (
            <>{isEdit ? '儲存改動' : '建立報價'}</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// LineItemRow — single product or service row
// ============================================================================

function LineItemRow({
  line,
  products,
  services,
  onSwitchType,
  onApplyProduct,
  onApplyService,
  onChange,
  onRemove,
  canRemove,
  onCreateProduct,
  onCreateService,
}: {
  line: DraftLine;
  products: Product[];
  services: Service[];
  onSwitchType: (t: 'PRODUCT' | 'SERVICE') => void;
  onApplyProduct: (id: string) => void;
  onApplyService: (id: string) => void;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  canRemove: boolean;
  onCreateProduct: (p: Product) => void;
  onCreateService: (s: Service) => void;
}) {
  const isProduct = line.itemType === 'PRODUCT';
  return (
    <div className="p-3 rounded border bg-muted/20 space-y-2">
      {/* Type toggle + remove */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-0.5 bg-muted rounded-md">
          <button
            type="button"
            onClick={() => onSwitchType('PRODUCT')}
            className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
              isProduct ? 'bg-background shadow font-medium' : 'text-muted-foreground'
            }`}
          >
            <Package className="h-3 w-3" /> Product
          </button>
          <button
            type="button"
            onClick={() => onSwitchType('SERVICE')}
            className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
              !isProduct ? 'bg-background shadow font-medium' : 'text-muted-foreground'
            }`}
          >
            <Briefcase className="h-3 w-3" /> Service
          </button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="移除"
        >
          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-2 items-start">
        {isProduct ? (
          <ProductAutocomplete
            className="col-span-12 md:col-span-4"
            products={products}
            value={line.productId}
            onChange={onApplyProduct}
            onCreate={onCreateProduct}
            label="產品"
          />
        ) : (
          <ServiceAutocomplete
            className="col-span-12 md:col-span-4"
            services={services}
            value={line.serviceId}
            onChange={onApplyService}
            onCreate={onCreateService}
            label="服務"
          />
        )}
        <div className="col-span-12 md:col-span-3 space-y-1">
          <Label className="text-xs text-muted-foreground">名稱 *</Label>
          <Input
            value={line.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Item name"
          />
        </div>
        <div className="col-span-4 md:col-span-1 space-y-1">
          <Label className="text-xs text-muted-foreground">數量</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="col-span-4 md:col-span-2 space-y-1">
          <Label className="text-xs text-muted-foreground">單價</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={line.unitPrice}
            onChange={(e) => onChange({ unitPrice: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="col-span-3 md:col-span-1 space-y-1">
          <Label className="text-xs text-muted-foreground">折扣%</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={line.discount}
            onChange={(e) => onChange({ discount: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="col-span-1 flex flex-col items-end justify-end h-full pt-5">
          <span className="text-xs font-semibold tabular-nums">
            {formatCurrency(lineTotal(line))}
          </span>
          {(() => {
            // Per-line GP$ / GP% display. In edit mode the server already
            // computed these; in create mode PRODUCT = 100% margin (cost
            // is zero), SERVICE shows "—" until the server fills it in
            // on POST.
            const total = lineTotal(line);
            const gp = line.lineGp ?? (line.itemType === 'PRODUCT' ? total : null);
            const gpPct = line.lineGpPercent ?? (line.itemType === 'PRODUCT' ? 100 : null);
            if (gp === null || gpPct === null) {
              return (
                <span className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                  GP: —
                </span>
              );
            }
            return (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                GP: {formatCurrency(gp)} ({gpPct.toFixed(0)}%)
              </span>
            );
          })()}
        </div>
      </div>

      {/* Service SOW snapshot preview */}
      {!isProduct && line.manDaySnapshot && line.manDaySnapshot.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            SOW · {line.manDaySnapshot.length} 個 role breakdown
          </summary>
          <div className="mt-1.5 space-y-0.5 pl-3 border-l-2 border-primary/30">
            {line.manDaySnapshot.map((m, i) => (
              <div key={i} className="flex justify-between text-muted-foreground">
                <span>{m.role} · {m.days}d × {formatCurrency(m.dayRate)}</span>
                <span className="tabular-nums">{formatCurrency(m.subtotal)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ============================================================================
// ProductAutocomplete — typeahead combobox over the products catalogue
// ============================================================================

function ProductAutocomplete({
  products, value, onChange, onCreate, label, className,
}: {
  products: Product[];
  value?: string;
  onChange: (id: string) => void;
  /** Store the created product in the parent catalogue list. The dialog
   *  itself does the API call; this callback is just the state update. */
  onCreate: (p: Product) => void;
  label: string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = products.find((p) => p.id === value);
  useEffect(() => {
    if (selected) setQuery(`${selected.sku} — ${selected.name}`);
  }, [selected?.id]);

  const filtered = useMemo(() => {
    if (!query) return products.slice(0, 10);
    const q = query.toLowerCase();
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 10);
  }, [products, query]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative" ref={wrapRef}>
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); if (value) onChange(''); }}
          onFocus={() => setOpen(true)}
          placeholder="搜尋 SKU 或名稱..."
        />
        {open && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-60 overflow-y-auto bg-white border border-border rounded shadow-lg">
            {filtered.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground text-center">搵唔到</div>
            ) : (
              filtered.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => { onChange(p.id); setOpen(false); }}
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted flex justify-between items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.sku} · {p.category ?? '—'}</div>
                  </div>
                  <span className="text-xs tabular-nums shrink-0 ml-2">{formatCurrency(Number(p.unitPrice))}</span>
                </button>
              ))
            )}
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => { setCreateOpen(true); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 text-sm text-primary hover:bg-muted rounded flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> 新增 Product「{query}」
              </button>
            </div>
          </div>
        )}
      </div>
      <ProductDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultName={query}
        onSaved={(created) => {
          if (created) {
            onCreate(created);
            onChange(created.id);
            setQuery(`${created.sku} — ${created.name}`);
          }
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

// ============================================================================
// ServiceAutocomplete — same pattern for services
// ============================================================================

function ServiceAutocomplete({
  services, value, onChange, onCreate, label, className,
}: {
  services: Service[];
  value?: string;
  onChange: (id: string) => void;
  /** Store the created service in the parent catalogue list. The dialog
   *  itself does the API call; this callback is just the state update. */
  onCreate: (s: Service) => void;
  label: string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = services.find((s) => s.id === value);
  useEffect(() => {
    if (selected) setQuery(selected.name);
  }, [selected?.id]);

  const filtered = useMemo(() => {
    if (!query) return services.slice(0, 10);
    const q = query.toLowerCase();
    return services
      .filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q))
      .slice(0, 10);
  }, [services, query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative" ref={wrapRef}>
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); if (value) onChange(''); }}
          onFocus={() => setOpen(true)}
          placeholder="搜尋服務名..."
        />
        {open && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-60 overflow-y-auto bg-white border border-border rounded shadow-lg">
            {filtered.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground text-center">搵唔到</div>
            ) : (
              filtered.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => { onChange(s.id); setOpen(false); }}
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted flex justify-between items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(s as Service & { category?: string }).category ?? '—'} · {s.manDays?.length ?? 0} roles
                    </div>
                  </div>
                  <span className="text-xs tabular-nums shrink-0 ml-2">{formatCurrency(Number(s.unitPrice))}</span>
                </button>
              ))
            )}
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => { setCreateOpen(true); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 text-sm text-primary hover:bg-muted rounded flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> 新增 Service「{query}」
              </button>
            </div>
          </div>
        )}
      </div>
      <QuickCreateServiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultName={query}
        onCreated={(s) => {
          onCreate(s);
          onChange(s.id);
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
