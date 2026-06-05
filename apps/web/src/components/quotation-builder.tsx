/**
 * QuotationBuilder
 *
 * Form used for both creating a new quotation and editing an existing DRAFT.
 * - Picks a company + product from dropdowns
 * - Live subtotal / tax / total recompute as you type
 * - Add / remove line items freely
 * - Saves via quotationsApi.create / .update
 *
 * `existing` is the quotation to edit; when undefined, the component starts
 * with one empty line item and is in create mode.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { productsApi, companiesApi, quotationsApi, type Company, type Product, type Quotation, type QuotationItem } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface DraftLine {
  // For UI: each row is either linked to a product (with productId) or freeform
  key: string;            // local React key
  productId?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount: number;       // percent
  itemId?: string;        // set when editing an existing item
}

interface QuotationBuilderProps {
  existing?: Quotation;
  onSaved: (q: Quotation) => void;
  onCancel: () => void;
}

function emptyLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
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
    productId: it.productId ?? undefined,
    name: it.name,
    description: it.description ?? undefined,
    quantity: Number(it.quantity),
    unitPrice: Number(it.unitPrice),
    discount: Number(it.discount ?? 0),
  }));
}

function lineTotal(line: DraftLine): number {
  const qty = Number(line.quantity) || 0;
  const price = Number(line.unitPrice) || 0;
  const disc = Number(line.discount) || 0;
  return qty * price * (1 - disc / 100);
}

export function QuotationBuilder({ existing, onSaved, onCancel }: QuotationBuilderProps) {
  const isEdit = !!existing;

  const [companyId, setCompanyId] = useState<string>(existing?.companyId ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [taxRate, setTaxRate] = useState<number>(existing ? Number(existing.taxRate) : 0);
  const [validUntil, setValidUntil] = useState<string>(
    existing?.validUntil ? existing.validUntil.slice(0, 10) : ''
  );
  const [lines, setLines] = useState<DraftLine[]>(linesFromQuotation(existing));

  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load companies + products for dropdowns
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, p] = await Promise.all([
          companiesApi.list({ limit: 200 }),
          productsApi.list({ limit: 200 }),
        ]);
        if (alive) {
          setCompanies(c);
          setProducts(p);
        }
      } catch (err) {
        if (alive) setError(`載入 dropdown 失敗: ${(err as Error).message}`);
      } finally {
        if (alive) setLoadingRefs(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Pre-fill company if existing has it but the dropdown list hasn't loaded yet
  useEffect(() => {
    if (!companyId && existing?.company) setCompanyId(existing.company.id);
  }, [existing, companies, companyId]);

  // Live totals
  const subtotal = useMemo(() => lines.reduce((s, l) => s + lineTotal(l), 0), [lines]);
  const taxAmount = subtotal * (Number(taxRate) / 100);
  const total = subtotal + taxAmount;

  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function applyProduct(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateLine(idx, { productId: undefined });
      return;
    }
    updateLine(idx, {
      productId: product.id,
      name: product.name,
      unitPrice: Number(product.unitPrice),
    });
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
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
            productId: l.productId,
            name: l.name,
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            discount: Number(l.discount) || 0,
          })),
          ...toUpdate.map((l) => quotationsApi.updateItem(existing.id, l.itemId!, {
            productId: l.productId,
            name: l.name,
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            discount: Number(l.discount) || 0,
          })),
        ]);
        // 3. refetch latest
        q = await quotationsApi.get(existing.id);
        onSaved(q);
      } else {
        const created = await quotationsApi.create({
          companyId,
          title: title || undefined,
          notes: notes || undefined,
          taxRate,
          validUntil: validUntil || undefined,
          items: validLines.map((l) => ({
            productId: l.productId,
            name: l.name,
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            discount: Number(l.discount) || 0,
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
    return <p className="text-sm text-muted-foreground p-4">載入公司 / 產品...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="company">客戶 *</Label>
          <Select id="company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">-- 揀客戶 --</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
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
        <div className="space-y-1.5">
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
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-4 w-4 mr-1" />
            加行
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {lines.map((line, idx) => (
            <div key={line.key} className="grid grid-cols-12 gap-2 items-start p-2 rounded border bg-muted/20">
              {/* Product picker */}
              <div className="col-span-12 md:col-span-4 space-y-1">
                <Label className="text-xs text-muted-foreground">產品</Label>
                <Select
                  value={line.productId ?? ''}
                  onChange={(e) => applyProduct(idx, e.target.value)}
                >
                  <option value="">-- 自訂 --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name} ({formatCurrency(Number(p.unitPrice))})
                    </option>
                  ))}
                </Select>
              </div>
              {/* Name */}
              <div className="col-span-12 md:col-span-3 space-y-1">
                <Label className="text-xs text-muted-foreground">名稱 *</Label>
                <Input
                  value={line.name}
                  onChange={(e) => updateLine(idx, { name: e.target.value })}
                  placeholder="Item name"
                />
              </div>
              {/* Qty */}
              <div className="col-span-4 md:col-span-1 space-y-1">
                <Label className="text-xs text-muted-foreground">數量</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) || 0 })}
                />
              </div>
              {/* Unit price */}
              <div className="col-span-4 md:col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">單價</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(idx, { unitPrice: Number(e.target.value) || 0 })}
                />
              </div>
              {/* Discount */}
              <div className="col-span-3 md:col-span-1 space-y-1">
                <Label className="text-xs text-muted-foreground">折扣%</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={line.discount}
                  onChange={(e) => updateLine(idx, { discount: Number(e.target.value) || 0 })}
                />
              </div>
              {/* Line total + remove */}
              <div className="col-span-1 flex flex-col items-end justify-between h-full pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeLine(idx)}
                  disabled={lines.length === 1}
                  aria-label="移除"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
              <div className="col-span-12 md:col-span-11 text-right text-sm font-semibold tabular-nums -mt-1 pr-2">
                = {formatCurrency(lineTotal(line))}
              </div>
            </div>
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
