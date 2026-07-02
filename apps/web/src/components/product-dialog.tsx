/**
 * ProductDialog — shared create/edit dialog for Products.
 *
 * Used in three places:
 *   1. `pages/products.tsx` — full create + edit flow (the original home of
 *      the form, extracted from line 199-360 of the page).
 *   2. `components/quotation-builder.tsx` — `ProductAutocomplete` "新增
 *      Product「...」" action (replaces the old `QuickCreateProductDialog`).
 *
 * Behaviour:
 *   - If `product` prop is provided → edit mode (calls `productsApi.update`).
 *   - If `product` prop is omitted → create mode (calls `productsApi.create`).
 *   - The optional `defaultName` prop pre-fills the name field in create mode
 *     (used by the autocomplete to seed the search query as a starting name).
 *   - `onSaved` is called after a successful save. If the dialog was in
 *     create mode, the newly-created `Product` is passed so callers can
 *     insert it into their local catalogue list without re-fetching.
 *   - `onSaved` is OPTIONAL — if not provided, the dialog still closes itself.
 *
 * Includes ALL fields: SKU / name / description / category / status
 * (ACTIVE/ARCHIVED/OUT_OF_STOCK) / currency / unitPrice / costPrice /
 * trackInventory / stockQuantity / lowStockThreshold.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { productsApi, settingsApi, ApiError, type Product } from '@/lib/api';

interface ProductDialogProps {
  /** When provided → edit mode. */
  product?: Product;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** In create mode, pre-fills the name input. Ignored in edit mode. */
  defaultName?: string;
  /**
   * Called after a successful save.
   *   - In edit mode: invoked with no args (the caller should refetch).
   *   - In create mode: invoked with the newly-created product so callers
   *     (e.g. autocomplete) can add it to their local list without a refetch.
   * Optional — if omitted, the dialog still closes itself.
   */
  onSaved?: (created?: Product) => void;
}

export function ProductDialog({
  product, open, onOpenChange, defaultName = '', onSaved,
}: ProductDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!product;
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? defaultName);
  const [description, setDescription] = useState(product?.description ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [unitPrice, setUnitPrice] = useState<number>(Number(product?.unitPrice) || 0);
  const [costPrice, setCostPrice] = useState<number>(Number(product?.costPrice) || 0);
  const [currency, setCurrency] = useState(product?.currency ?? 'HKD');
  const [status, setStatus] = useState<Product['status']>(product?.status ?? 'ACTIVE');
  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? true);
  const [stockQuantity, setStockQuantity] = useState<number>(Number(product?.stockQuantity) || 0);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(Number(product?.lowStockThreshold) || 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // P2 multi-currency (2026-06-29): pre-fill the currency picker with
  // the admin-configured default (typically RMB), not hard-coded HKD.
  // Same React Query key as /settings/currency so the cache is shared —
  // by the time the user opens the create dialog the config is usually
  // already in cache from the Quotation Builder's prefetch.
  const { data: currencyCfg } = useQuery({
    queryKey: ['settings', 'currency'],
    queryFn: () => settingsApi.getCurrency(),
    staleTime: 60_000,
  });
  // userTouchedCurrency guards against the second open of the dialog
  // inheriting a stale value from the previous session. The re-seed
  // useEffect below resets it on every open.
  const [userTouchedCurrency, setUserTouchedCurrency] = useState(false);

  // Re-seed when the dialog opens (handles edit-mode opening with a
  // different product, and create-mode opening with a new defaultName).
  useEffect(() => {
    if (open) {
      setSku(product?.sku ?? '');
      setName(product?.name ?? defaultName);
      setDescription(product?.description ?? '');
      setCategory(product?.category ?? '');
      setUnitPrice(Number(product?.unitPrice) || 0);
      setCostPrice(Number(product?.costPrice) || 0);
      // Edit mode: trust the persisted row. Create mode: prefer the
      // system default (from settingsApi); fall back to 'RMB' if the
      // fetch hasn't resolved yet (matches the Prisma default).
      setCurrency(product?.currency ?? currencyCfg?.default ?? 'RMB');
      setUserTouchedCurrency(false);
      setStatus(product?.status ?? 'ACTIVE');
      setTrackInventory(product?.trackInventory ?? true);
      setStockQuantity(Number(product?.stockQuantity) || 0);
      setLowStockThreshold(Number(product?.lowStockThreshold) || 0);
      setError(null);
    }
  }, [open, product, defaultName, currencyCfg?.default]);

  // If the user hasn't touched the picker AND the currency config
  // resolves after the dialog opens, sync the picker to the live
  // default. Mirrors the userTouchedTax pattern in QuotationBuilder.
  useEffect(() => {
    if (open && !isEdit && !userTouchedCurrency && currencyCfg?.default) {
      setCurrency(currencyCfg.default);
    }
  }, [open, isEdit, userTouchedCurrency, currencyCfg?.default]);

  async function submit() {
    setError(null);
    if (!sku.trim() || !name.trim()) {
      setError(t('product.dialog.errors.skuAndNameRequired'));
      return;
    }
    if (unitPrice < 0) {
      setError(t('product.dialog.errors.priceNegative'));
      return;
    }
    setSubmitting(true);
    try {
      const data = {
        sku: sku.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        unitPrice,
        costPrice: costPrice || undefined,
        currency,
        status,
        trackInventory,
        stockQuantity: trackInventory ? stockQuantity : undefined,
        lowStockThreshold: trackInventory && lowStockThreshold > 0 ? lowStockThreshold : undefined,
      };
      if (isEdit && product) {
        await productsApi.update(product.id, data);
        onSaved?.();
      } else {
        const created = await productsApi.create(data);
        onSaved?.(created);
      }
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError(
          (e.body && typeof e.body === 'object' && 'error' in e.body
            ? (e.body as { error: string }).error
            : null) ?? t('product.dialog.errors.skuConflict')
        );
      } else {
        setError(e instanceof Error ? e.message : t('product.dialog.errors.saveFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('product.dialog.editTitle') : t('product.dialog.createTitle')}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="space-y-4"
        >
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pd-sku">{t('product.dialog.sku')}</Label>
              <Input
                id="pd-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value.toUpperCase())}
                placeholder={t('product.dialog.skuPlaceholder')}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-name">{t('product.dialog.name')}</Label>
              <Input
                id="pd-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('product.dialog.namePlaceholder')}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pd-desc">{t('product.dialog.description')}</Label>
            <Textarea
              id="pd-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('product.dialog.descriptionPlaceholder')}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pd-cat">{t('product.dialog.category')}</Label>
              <Input
                id="pd-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t('product.dialog.categoryPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-status">{t('product.dialog.status')}</Label>
              <Select
                id="pd-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as Product['status'])}
              >
                <option value="ACTIVE">{t('product.status.ACTIVE')}</option>
                <option value="ARCHIVED">{t('product.status.ARCHIVED')}</option>
                <option value="OUT_OF_STOCK">{t('product.status.OUT_OF_STOCK')}</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pd-price">{t('product.dialog.price')}</Label>
              <Input
                id="pd-price"
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(Number(e.target.value))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-cost">{t('product.dialog.cost')}</Label>
              <Input
                id="pd-cost"
                type="number"
                min={0}
                step="0.01"
                value={costPrice}
                onChange={(e) => setCostPrice(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-cur">{t('product.dialog.currency')}</Label>
              <Select
                id="pd-cur"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setUserTouchedCurrency(true);
                }}
              >
                {/* P2 multi-currency (2026-06-29): RMB/HKD/MOP are the
                    three system currencies (admin-configurable default
                    in /settings/currency). USD/EUR/GBP/legacy CNY left
                    in as fallbacks for products priced in a non-system
                    currency. */}
                <option value="RMB">{t('product.currency.RMB')}</option>
                <option value="HKD">{t('product.currency.HKD')}</option>
                <option value="MOP">{t('product.currency.MOP')}</option>
                <option value="USD">{t('product.currency.USD')}</option>
                <option value="CNY">{t('product.currency.CNY')}</option>
                <option value="EUR">{t('product.currency.EUR')}</option>
                <option value="GBP">{t('product.currency.GBP')}</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trackInventory}
                onChange={(e) => setTrackInventory(e.target.checked)}
                className="rounded"
              />
              {t('product.dialog.trackInventory')}
            </label>
            {trackInventory && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div className="space-y-1.5">
                  <Label htmlFor="pd-stock">{t('product.dialog.stock')}</Label>
                  <Input
                    id="pd-stock"
                    type="number"
                    min={0}
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pd-low">{t('product.dialog.lowStock')}</Label>
                  <Input
                    id="pd-low"
                    type="number"
                    min={0}
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(Number(e.target.value))}
                    placeholder={t('product.dialog.lowStockPlaceholder')}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('product.dialog.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isEdit ? t('product.dialog.save') : t('product.dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
