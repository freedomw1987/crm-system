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
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, X, Package, Briefcase, ChevronDown, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label, Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  productsApi, servicesApi, quotationsApi, settingsApi,
  type Product, type Service, type ServiceManDay,
  type Quotation, type QuotationItem,
} from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { QuickCreateServiceDialog } from './quick-create-service-dialog';
import { ProductDialog } from './product-dialog';
import { CompanyAutocomplete } from './company-autocomplete';
import { DealAutocomplete } from './deal-autocomplete';
import { UserAutocomplete } from './user-autocomplete';
import { createClientId } from '@/lib/client-id';

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
    key: createClientId('line'),
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
    key: it.id ?? createClientId('line'),
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

// 2026-07-01 (US-MAINT-1): canonical display name for the
// Maintenance Service line item. Used both as the `name` field
// when we push the line via `addMaintenanceFeeLine` AND as the
// detector for `hasMaintenanceFee` (to disable the button when
// one is already present). Centralised so the label never
// drifts between the two call sites.
//
// 2026-07-01 rename: 維修費用 → 維護費用 + "Maintenance Fee" →
// "Maintenance Service" (per user request). The JS constant name
// keeps the legacy `MAINTENANCE_FEE_NAME` identifier to avoid
// touching every reference; only the displayed string changes.
const MAINTENANCE_FEE_NAME = '維護費用 / Maintenance Service';

/**
 * Compute the rate-to-HKD multiplier for a chosen currency.
 *
 *   HKD → HKD: 1
 *   RMB → HKD: cfg.rates['RMB->HKD']
 *   MOP → HKD: cfg.rates['RMB->HKD'] / cfg.rates['RMB->MOP']
 *
 * Mirrors the server-side `hkdRateFor` helper in
 * apps/api/src/routes/settings.ts so the builder's preview matches
 * the value that will be persisted. Returns 0 if config is missing
 * (the HKD preview line is hidden in that case — the user will
 * see the real number after save+reload).
 */
function hkdRateFromConfig(
  picked: 'RMB' | 'HKD' | 'MOP',
  cfg: { rates: { 'RMB->HKD': number; 'RMB->MOP': number } } | null,
): number {
  if (!cfg) return 0;
  if (picked === 'HKD') return 1;
  if (picked === 'RMB') return cfg.rates['RMB->HKD'];
  const m = cfg.rates['RMB->MOP'];
  if (!Number.isFinite(m) || m <= 0) return 0;
  return cfg.rates['RMB->HKD'] / m;
}

/**
 * 2026-06-29: mirror of `hkdRateFromConfig` for the MOP equivalent
 * row. Math:
 *   MOP → MOP: 1
 *   RMB → MOP: cfg.rates['RMB->MOP']
 *   HKD → MOP: cfg.rates['RMB->MOP'] / cfg.rates['RMB->HKD']
 * Returns 0 when the config is missing or the divisor is
 * non-positive — same defensive pattern as `hkdRateFromConfig`.
 * Used only for the live preview row in the Totals card; the
 * saved snapshot on the Quotation row is the source of truth
 * after save+reload (see apps/api/src/routes/quotation.ts).
 */
function mopRateFromConfig(
  picked: 'RMB' | 'HKD' | 'MOP',
  cfg: { rates: { 'RMB->HKD': number; 'RMB->MOP': number } } | null,
): number {
  if (!cfg) return 0;
  if (picked === 'MOP') return 1;
  if (picked === 'RMB') return cfg.rates['RMB->MOP'];
  const h = cfg.rates['RMB->HKD'];
  if (!Number.isFinite(h) || h <= 0) return 0;
  return cfg.rates['RMB->MOP'] / h;
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
  // 2026-06-26: edit-mode pre-fill for the Deal field. Without this
  // fallback, opening the builder on an existing quotation that was
  // already linked to a Deal would show the autocomplete as empty,
  // and the user's first save would have to re-pick the same deal
  // (or risk detaching it if they hit save without touching the
  // field). Existing.dealId is the source of truth for the link; the
  // explicit defaultDealId / initialDealId props still win so the
  // create-from-deal-card shortcut can override the default.
  const seedDealId = defaultDealId ?? initialDealId ?? existing?.dealId ?? '';
  const [companyId, setCompanyId] = useState<string>(seedCompanyId);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [taxRate, setTaxRate] = useState<number>(existing ? Number(existing.taxRate) : 0);
  // Day 14.7 Step 9 — flag tracks whether the user has manually touched
  // the tax-rate input. If they have, the auto-prefill effect below won't
  // overwrite their value when getTax() resolves.
  const [userTouchedTax, setUserTouchedTax] = useState<boolean>(false);
  // P2 multi-currency (2026-06-29): billing currency + chosen-flag.
  // Same pre-fill pattern as the tax rate (system default in CREATE
  // mode, existing value in EDIT mode). The `userTouchedCurrency`
  // guard means a slow getCurrency() fetch can't clobber a value
  // the user already picked.
  const [currency, setCurrency] = useState<'RMB' | 'HKD' | 'MOP'>(
    (existing?.currency as 'RMB' | 'HKD' | 'MOP' | undefined) ?? 'RMB',
  );
  const [userTouchedCurrency, setUserTouchedCurrency] = useState<boolean>(false);
  // Cache of the latest system config (default + rates). The rate
  // lets us show `≈ HKD X @ rate` in the Totals card before save.
  const [currencyConfig, setCurrencyConfig] = useState<{
    default: 'RMB' | 'HKD' | 'MOP';
    rates: { 'RMB->HKD': number; 'RMB->MOP': number };
  } | null>(null);
  const [validUntil, setValidUntil] = useState<string>(
    existing?.validUntil ? existing.validUntil.slice(0, 10) : ''
  );
  const [dealId, setDealId] = useState<string>(seedDealId);
  // 2026-06-26: sales-rep state. In edit mode, pre-fill from
  // existing.salesRepId; in create mode, leave null (the backend
  // defaults salesRepId to the authenticated userId on POST when
  // the field is omitted). The user can override either way.
  const [salesRepId, setSalesRepId] = useState<string | null>(existing?.salesRepId ?? null);
  const [lines, setLines] = useState<DraftLine[]>(linesFromQuotation(existing));

  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  // RG-2026-06-07-DEAL-AUTOCOMPLETE: removed the `companyDeals` state
  // and its `useEffect` (formerly lines ~149, ~179-195) — the new
  // <DealAutocomplete> component owns its own `deals-by-company` query
  // (see apps/web/src/components/deal-autocomplete.tsx). Keeping the
  // data inside the autocomplete means Quick-Create's local catalogue
  // update is visible without a parent re-render, and the parent
  // doesn't need to coordinate invalidations.
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

  // RG-2026-06-07-DEAL-AUTOCOMPLETE: removed the `useEffect` that
  // fetched `/api/deals?companyId=...` whenever companyId changed.
  // The new <DealAutocomplete> handles its own scoping via the
  // `companyId` prop and react-query cache. See the comment at the
  // top of `companyDeals` removal above for the rationale.

  // Day 14.7 Step 9 — In CREATE mode, prefill the tax-rate input with the
  // system default from /api/settings/tax. The user can still override per
  // quote (Plan option A). Guarded by `userTouchedTax` so we don't clobber
  // a value the user already typed before the fetch resolved. In EDIT mode
  // `existing.taxRate` is already in state, so we skip the fetch.
  useEffect(() => {
    if (existing) return;
    if (userTouchedTax) return;
    let alive = true;
    settingsApi.getTax()
      .then((tax) => {
        if (!alive) return;
        if (userTouchedTax) return; // re-check after await
        const n = Number(tax.rate);
        if (Number.isFinite(n) && n !== taxRate) setTaxRate(n);
      })
      .catch(() => {
        // Non-fatal: if /settings/tax fails, the user can still type a
        // rate manually. Don't block the form.
      });
    return () => { alive = false; };
    // We intentionally only run on mount + when the touched flag flips,
    // not on taxRate changes (to avoid re-fetches after the prefill).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, userTouchedTax]);

  // P2 multi-currency (2026-06-29): prefill the currency picker on
  // mount from /api/settings/currency. Cache the config (default +
  // rates) so the Totals card can show the live HKD-equivalent
  // preview without re-fetching. Mirrors the tax prefill above —
  // the `userTouchedCurrency` guard means a slow fetch can't
  // overwrite a value the user already picked (e.g. for a quote
  // already in flight when admin changes the system default).
  useEffect(() => {
    let alive = true;
    settingsApi.getCurrency()
      .then((cfg) => {
        if (!alive) return;
        setCurrencyConfig(cfg);
        if (!existing && !userTouchedCurrency) {
          setCurrency(cfg.default);
        }
      })
      .catch(() => {
        // Non-fatal: if /settings/currency fails, the user can still
        // pick a currency manually. Don't block the form.
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, userTouchedCurrency]);

  // 2026-07-01 (US-MAINT-1): read the Maintenance Service rate
  // from /settings/maintenance-fee so the "+ 維護費用" button can
  // pre-compute the fee as `subtotal × rate / 100`. We mirror the
  // tax/currency pattern: 60s stale time so the cache is shared
  // with the settings page.
  // 2026-07-01 rename: 維修費用 → 維護費用 + "Maintenance Fee" →
  // "Maintenance Service" (per user request). Internal identifier
  // names (MAINTENANCE_FEE_NAME, hasMaintenanceFee, query key,
  // settingsApi.getMaintenanceFee) keep their legacy names to
  // minimise churn.
  const { data: maintenanceFeeCfg } = useQuery({
    queryKey: ['settings', 'maintenance-fee'],
    queryFn: () => settingsApi.getMaintenanceFee(),
    staleTime: 60_000,
  });

  // True if any line item is already a maintenance-service row.
  // Used to disable the button (we only allow ONE fee line per
  // quote). Name match is intentional — we use the canonical
  // display name "維護費用 / Maintenance Service" set by
  // `addMaintenanceFeeLine`.
  const hasMaintenanceFee = lines.some((l) => l.name === MAINTENANCE_FEE_NAME);

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

  // 2026-07-01 (US-IMPORT-SKU): the SKU convention used by the
// Barco Excel template and surfaced by the export adapter:
//   - "Barco-MA"  → maintenance service line (no man-day)
//   - "Barco-PS"  → regular professional-service line (with man-day)
//   - product.sku → snapshot the catalogued value for PRODUCT lines
// Setting these at create-time means the round-trip
// (build → export → re-import) preserves the line classification
// — the AI import heuristic (`isNoManDayLine`) keys off the
// snapshot SKU.
const MAINTENANCE_SKU = 'Barco-MA';
const SERVICE_SKU = 'Barco-PS';

  function addLine(type: 'PRODUCT' | 'SERVICE' = 'PRODUCT') {
    // Pre-fill the SKU with the Barco convention so the line
    // exports + re-imports as the right kind. The user can
    // overwrite the SKU inline before save.
    const sku = type === 'SERVICE' ? SERVICE_SKU : undefined;
    setLines((prev) => [...prev, { ...emptyLine(), itemType: type, sku }]);
  }

  // 2026-07-01 (US-MAINT-1): push a pre-filled Maintenance Service
  // line item into `lines`. The unitPrice is
  // `current_draft_subtotal × rate / 100`, snapshotted at the
  // moment the button is clicked — later edits to other lines do
  // NOT auto-update this fee (the user must delete it and click
  // the button again to refresh). The line is typed as SERVICE so
  // the existing Service SOW preview in `LineItemRow` keeps
  // rendering correctly (`manDaySnapshot` stays undefined → no
  // SOW breakdown, no serviceId → costSnapshot=0 → GP% = 100%,
  // same as a PRODUCT line, which is what we want for a flat
  // system fee).
  function addMaintenanceFeeLine() {
    if (!maintenanceFeeCfg || hasMaintenanceFee) return;
    const rate = Number(maintenanceFeeCfg.rate) || 0;
    // Recompute subtotal over the CURRENT draft lines so the user
    // sees the fee match the visible total at the moment of the
    // click. We re-derive rather than reading the existing
    // `subtotal` memo because the user may click the button right
    // after editing a line and we want the freshest snapshot.
    const currentSubtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
    const feeAmount = Math.round(currentSubtotal * rate * 100) / 100 / 100;
    // Note: rate is stored as a percentage (e.g. 20 = 20%), so we
    // multiply by rate/100. The `Math.round(... * 100) / 100` is
    // just to clean up floating point dust (e.g. 1234.5600000001).
    setLines((prev) => [
      ...prev,
      {
        ...emptyLine(),
        itemType: 'SERVICE',
        // 2026-07-01 (US-IMPORT-SKU): the maintenance-fee
        // line carries the Barco-MA SKU so the export writes
        // "Barco-MA" to Excel and a subsequent re-import
        // recognises it via the `isNoManDayLine` heuristic.
        sku: MAINTENANCE_SKU,
        name: MAINTENANCE_FEE_NAME,
        quantity: 1,
        unitPrice: feeAmount,
        discount: 0,
        manDaySnapshot: undefined,
      },
    ]);
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function validate(): string | null {
    if (!companyId) return '選個客戶先';
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
        // 1. update header. 2026-06-26: include dealId so the
        //    Quotation-Deal link persists across edits. Use `?? null`
        //    so an explicitly-cleared autocomplete (setDealId(''))
        //    detaches the quotation from its deal rather than being
        //    dropped by `|| undefined` (which would leave the FK
        //    unchanged on the server).
        let q = await quotationsApi.update(existing.id, {
          title: title || undefined,
          notes: notes || undefined,
          taxRate,
          validUntil: validUntil || undefined,
          dealId: dealId || null,
          // P2 multi-currency (2026-06-29): only send `currency`
          // when the user actually changed it, mirroring the
          // salesRepId pattern below. The server treats an omitted
          // field as "leave unchanged" (see apps/api/src/routes/
          // quotation.ts:735). Sending the current value verbatim
          // on every save would also work but it would churn the
          // SENT-lock audit log with no-op diffs.
          currency:
            currency === existing.currency ? undefined : currency,
          // 2026-06-26: only send salesRepId when it changed so the
          // backend doesn't touch the FK on no-op saves (undefined
          // means "leave unchanged"). If the user explicitly cleared
          // it (salesRepId is now null and was set before), pass null
          // to detach.
          salesRepId:
            salesRepId === existing.salesRepId ? undefined : (salesRepId || null),
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
          // 2026-06-26: forward the picked sales rep. Omitting the
          // field on create lets the backend default to userId (the
          // most common case — sales rep creates their own quote).
          salesRepId: salesRepId || undefined,
          title: title || undefined,
          notes: notes || undefined,
          taxRate,
          // P2 multi-currency (2026-06-29): billing currency. Always
          // send (the state is initialised to existing.currency on
          // EDIT and to the system default on CREATE so it's never
          // undefined here).
          currency,
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
          {/* RG-2026-06-07-DEAL-AUTOCOMPLETE: was a plain <Select>
              backed by a useEffect-fetched `companyDeals` array.
              Replaced with <DealAutocomplete> so Sales can also
              create a new deal inline (e.g. when the customer just
              landed and there are no deals on the kanban yet). The
              autocomplete is disabled until a customer is picked
              (matches the prior behaviour) and shows a placeholder
              hint to guide the user. */}
          <DealAutocomplete
            value={dealId}
            onChange={setDealId}
            companyId={companyId}
            label=""
          />
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
            // Day 14.7 Step 9 — mark the field as touched so the auto-prefill
            // effect won't overwrite a value the user typed before getTax()
            // resolved.
            onChange={(e) => {
              setUserTouchedTax(true);
              setTaxRate(Number(e.target.value) || 0);
            }}
          />
        </div>
        {/* P2 multi-currency (2026-06-29): 出單貨幣 picker. Sits in
            its own 2-col cell so the label + dropdown have room to
            breathe. The system default (loaded from /settings/currency)
            pre-fills CREATE mode; EDIT mode pre-fills from the existing
            row. The SENT lock means edits to a SENT quote's currency
            return 409 — the server enforces that path. */}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="currency">出單貨幣</Label>
          <Select
            id="currency"
            className="max-w-xs"
            value={currency}
            onChange={(e) => {
              setUserTouchedCurrency(true);
              setCurrency(e.target.value as 'RMB' | 'HKD' | 'MOP');
            }}
          >
            <option value="RMB">人民幣 (RMB)</option>
            <option value="HKD">港幣 (HKD)</option>
            <option value="MOP">澳門幣 (MOP)</option>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            新建報價預設跟 <a href="/settings/currency" className="underline">系統設定</a>;
            HKD 等值會在儲存時寫入快照。
          </p>
        </div>
        {/* 2026-06-26: 銷售員 picker. Pre-fills from existing.salesRepId
            in edit mode; null in create mode (the backend defaults to
            the authenticated user). The user can override either way.
            Sits in a 2-col cell on the same row as the tax rate to
            keep the form compact. */}
        <div className="space-y-1.5 md:col-span-2">
          <UserAutocomplete
            value={salesRepId}
            onChange={setSalesRepId}
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
            {/* 2026-07-01 (US-MAINT-1): "+ 維護費用" button.
                - Computes fee = current draft subtotal × rate / 100.
                - Disabled when rate hasn't loaded OR when an existing
                  maintenance-service line is already present (we
                  only allow ONE fee line per quote — re-click
                  requires the user to delete the existing line first).
                - Title explains the calculation so the user isn't
                  surprised by the snapshot behaviour ("subtotal 改動
                  不會自動更新這行").
                - 2026-07-01 rename: 維修費用 → 維護費用 (per user
                  request). */}
            <Button
              size="sm"
              variant="outline"
              onClick={addMaintenanceFeeLine}
              disabled={!maintenanceFeeCfg || hasMaintenanceFee}
              title={
                hasMaintenanceFee
                  ? '此 Quotation 已有維護費用 line item;請先刪除再按'
                  : `加入一行維護費用 (= subtotal × ${maintenanceFeeCfg?.rate ?? 20}% / 100)`
              }
            >
              <Wrench className="h-3 w-3 mr-1" /> + 維護費用
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
              currency={currency}
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
            <span className="text-muted-foreground">Subtotal ({currency})</span>
            <span className="tabular-nums">{formatCurrency(subtotal, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax ({taxRate}%)</span>
            <span className="tabular-nums">{formatCurrency(taxAmount, currency)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 mt-2 text-base font-bold">
            <span>Total ({currency})</span>
            <span className="tabular-nums">{formatCurrency(total, currency)}</span>
          </div>
          {/* P2 multi-currency (2026-06-29): HKD equivalent preview.
              Mirrors the detail-page row that prints under the Total.
              Hidden when the chosen currency is HKD (redundant). The
              rate is sourced from /settings/currency so it reflects
              any admin edits since the page loaded. */}
          {currency !== 'HKD' && (() => {
            const rate = hkdRateFromConfig(currency, currencyConfig);
            if (rate <= 0) return null;
            const totalHKD = total * rate;
            return (
              <div
                className="flex justify-between text-xs text-muted-foreground pt-1"
                title="使用 /settings/currency 的當前匯率計算。儲存後此數字會以當下的匯率快照寫入該 row,後續修改系統匯率不會重新計算。"
              >
                <span>≈ HKD (匯率 {rate.toFixed(4)})</span>
                <span className="tabular-nums">{formatCurrency(totalHKD, 'HKD')}</span>
              </div>
            );
          })()}
          {/* P2 multi-currency (2026-06-30): MOP equivalent preview.
              Mirror of the HKD row above; hidden when the chosen
              currency is MOP (redundant). Rate is sourced from
              /settings/currency so it reflects admin edits since the
              page loaded. After save+reload the snapshot value on
              the Quotation row is the source of truth (replacing
              this live preview). */}
          {currency !== 'MOP' && (() => {
            const rate = mopRateFromConfig(currency, currencyConfig);
            if (rate <= 0) return null;
            const totalMOP = total * rate;
            return (
              <div
                className="flex justify-between text-xs text-muted-foreground pt-1"
                title="使用 /settings/currency 的當前匯率計算。儲存後此數字會以當下的匯率快照寫入該 row,後續修改系統匯率不會重新計算。"
              >
                <span>≈ MOP (匯率 {rate.toFixed(4)})</span>
                <span className="tabular-nums">{formatCurrency(totalMOP, 'MOP')}</span>
              </div>
            );
          })()}
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
              {formatCurrency(totalGp, currency)} ({totalGpPct.toFixed(0)}%)
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
  currency,
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
  currency: 'RMB' | 'HKD' | 'MOP';
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
            // P1-10: snapshot wins over the live catalogue so a deleted
            // or renamed product doesn't blank the line or change what
            // the customer was quoted.
            snapshotName={line.name}
            snapshotSku={line.sku}
          />
        ) : (
          <ServiceAutocomplete
            className="col-span-12 md:col-span-4"
            services={services}
            value={line.serviceId}
            onChange={onApplyService}
            onCreate={onCreateService}
            label="服務"
            // P1-10: see ProductAutocomplete above.
            snapshotName={line.name}
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
            {formatCurrency(lineTotal(line), currency)}
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
                GP: {formatCurrency(gp, currency)} ({gpPct.toFixed(0)}%)
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
                <span>{m.role} · {m.days}d × {formatCurrency(m.dayRate, currency)}</span>
                <span className="tabular-nums">{formatCurrency(m.subtotal, currency)}</span>
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

/**
 * Pure helper: compute the display label for a Quotation line's product/service
 * autocomplete input. Snapshot wins over the live record so a deleted or
 * renamed Product/Service doesn't blank the input or silently change what
 * the customer was quoted (P1-10).
 *
 * Precedence:
 *   1. snapshot (always wins)
 *   2. live (only when there's no snapshot)
 *   3. empty (nothing to show)
 *
 * @param snapshotName  the name captured into QuotationItem at line creation
 * @param snapshotSku   the SKU captured into QuotationItem at line creation
 *                      (products only; pass undefined for services)
 * @param live          the matching live record, or null if deleted
 * @returns the string the autocomplete input should display
 */
export function autocompleteLabel(
  snapshotName: string | undefined,
  snapshotSku: string | undefined,
  live: { name?: string | null; sku?: string | null } | null | undefined,
): string {
  const sku = snapshotSku ?? live?.sku ?? '';
  const name = snapshotName ?? live?.name ?? '';
  if (!sku && !name) return '';
  return sku ? `${sku} — ${name}` : name;
}

/**
 * Pure helper: is the underlying catalogue record gone?
 * Used to decide whether to render the "(已刪除)" badge.
 */
export function isAutocompleteDeleted(
  value: string | undefined,
  live: unknown,
): boolean {
  return !!value && !live;
}

function ProductAutocomplete({
  products, value, onChange, onCreate, label, className,
  /** Snapshot of the product's SKU captured into QuotationItem at
   *  line-creation time. We display this whenever it's set, even if
   *  the live product has been deleted or renamed — the line must
   *  keep showing the historical value the customer was quoted. */
  snapshotName,
  snapshotSku,
}: {
  products: Product[];
  value?: string;
  onChange: (id: string) => void;
  /** Store the created product in the parent catalogue list. The dialog
   *  itself does the API call; this callback is just the state update. */
  onCreate: (p: Product) => void;
  label: string;
  /** Snapshot of the product's name at line creation. */
  snapshotName?: string;
  /** Snapshot of the product's SKU at line creation. */
  snapshotSku?: string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = products.find((p) => p.id === value);
  // The DB snapshot on QuotationItem is the source of truth for what we
  // display in the input. The live `selected` is only a fallback for the
  // create-a-new-line case (no snapshot yet, but the user just picked a
  // product). If the underlying product was DELETED, `selected` is
  // undefined and we show the snapshot + a "(已刪除)" badge. If it was
  // RENAMED, the snapshot still wins so the line stays historically
  // accurate. See `autocompleteLabel` for the full precedence.
  const isDeleted = isAutocompleteDeleted(value, selected);
  useEffect(() => {
    const label = autocompleteLabel(snapshotName, snapshotSku, selected);
    if (label) setQuery(label);
  }, [value, selected?.id, snapshotName, snapshotSku]);

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
          data-testid="product-autocomplete-input"
        />
        {/* Day N+1 (P1-10): show a "(已刪除)" badge when the product FK
            is set but the live record is gone. The DB snapshot still
            holds name/sku/price so the line stays editable, but the
            user should know the catalogue link is broken. */}
        {isDeleted && (
          <Badge
            variant="destructive"
            data-testid="product-deleted-badge"
            className="absolute -top-1 right-1 text-[10px] px-1.5 py-0"
          >
            已刪除
          </Badge>
        )}
        {open && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-60 overflow-y-auto bg-white border border-border rounded shadow-lg">
            {filtered.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground text-center">查無資料</div>
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
                  <span className="text-xs tabular-nums shrink-0 ml-2">{formatCurrency(Number(p.unitPrice), p.currency)}</span>
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
  /** Snapshot of the service's name at line creation. Displayed
   *  whenever set, so a renamed service doesn't silently change what
   *  the customer was quoted. */
  snapshotName,
}: {
  services: Service[];
  value?: string;
  onChange: (id: string) => void;
  /** Store the created service in the parent catalogue list. The dialog
   *  itself does the API call; this callback is just the state update. */
  onCreate: (s: Service) => void;
  label: string;
  className?: string;
  /** Snapshot of the service's name at line creation. */
  snapshotName?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = services.find((s) => s.id === value);
  // Same precedence as ProductAutocomplete: snapshot wins, live is
  // fallback. The DB QuotationItem stores the name (and manDaySnapshot)
  // captured at line creation, so we surface that even when the live
  // service has been deleted or renamed.
  const isDeleted = isAutocompleteDeleted(value, selected);
  useEffect(() => {
    const label = autocompleteLabel(snapshotName, undefined, selected);
    if (label) setQuery(label);
  }, [value, selected?.id, snapshotName]);

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
          data-testid="service-autocomplete-input"
        />
        {/* See ProductAutocomplete for context. Snapshot wins; the
            "(已刪除)" badge flags the broken catalogue link. */}
        {isDeleted && (
          <Badge
            variant="destructive"
            data-testid="service-deleted-badge"
            className="absolute -top-1 right-1 text-[10px] px-1.5 py-0"
          >
            已刪除
          </Badge>
        )}
        {open && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-60 overflow-y-auto bg-white border border-border rounded shadow-lg">
            {filtered.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground text-center">查無資料</div>
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
                  <span className="text-xs tabular-nums shrink-0 ml-2">{formatCurrency(Number(s.unitPrice), s.currency)}</span>
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
