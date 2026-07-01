/**
 * CRM → bc-quotation shape adapter
 * 2026-06-07: 將 Prisma 嘅 Quotation + QuotationItem + Company + User + Product + Service
 * 攤平落 bc-quotation 5 個 worksheet 期望嘅 shape。BoardPro-only field 暫時
 * hard-code 為 0 / "" / null (見 deriveBoardProFields 函式), 後續 US-A6
 * 補返 schema extension 後再讀返。
 *
 * 用途:
 *   const flat = await adaptCrmQuotationForExcel(prismaQuotation);
 *   const buf = generateQuotationExcel(flat, "zh", "v2");
 *
 * 參考: ~/www/bc-quotation/src/helpers/quotation_worksheet.ts 嘅 field 用法。
 */

import _ from "lodash";
// 2026-06-07 (US-A5): use `any` for the Prisma model types — `@crm/db` only
// re-exports enums, not the model types (those live in `@prisma/client`).
// Casting the input as `any` here keeps the adapter decoupled from the
// generated Prisma client surface and matches the contract documented in
// the route handler's `include` clause.

export interface FlatQuotationForExcel {
  // bc-quotation 期望嘅 top-level fields
  _createdAt: Date | string;
  auto_increment: string; // 用 quotation.number
  revision: string; // 預設 "0" (CRM 冇 revision field)
  client_name: string;
  sales_name: string;
  sales_email: string;
  region: Array<{ value: string }>; // bc shape: array of { value: label }
  project_name: string;
  total_price: number;
  total_price_v1: number;
  sales_cost_total: number;
  sales_cost_total_v1: number;
  barco_sales_total: number; // 同 sales_cost_total
  // P2 multi-currency (2026-06-29): the chosen billing currency +
  // HKD + MOP snapshots. Carried on so the worksheet renders the
  // persisted currency in E8 (was hard-coded) and can append both
  // HKD- and MOP-equivalent rows to the totals block.
  currency: 'RMB' | 'HKD' | 'MOP' | string;
  exchangeRateToHKD: number;
  total_price_hkd: number; // total * rate, snapshotted on the row
  exchangeRateToMOP: number;
  total_price_mop: number; // total * rate, snapshotted on the row
  QuotationItem: Array<FlatQuotationItemForExcel>;
}

export interface FlatQuotationItemForExcel {
  index: string; // 1-based, 跟 position 排序
  sector: string;
  is_included: "0" | "1";
  is_optional: "0" | "1";
  product_name: string;
  product_name_en: string;
  qty: string | number;
  unit_price: string | number;
  unit_price_v1: string | number;
  subtotal: string | number;
  subtotal_v1: string | number;
  sku: string;
  sales_cost: string | number;
  sales_cost_subtotal: string | number;
  sales_cost_v1: string | number;
  sales_cost_subtotal_v1: string | number;
  barco_sale_cost: string | number;
  barco_sale_cost_subtotal: string | number;
  adjustment_price: string | number;
  notice: string;
  notice_en: string;
  sow: string;
  sow_en: string;
  assumption: string;
  assumption_en: string;
}

/**
 * Adapt a fully-loaded CRM Prisma Quotation into the shape that bc-quotation's
 * 5 worksheet helpers consume.
 *
 * @param prismaQuotation - Must include: items[].product, items[].service,
 *   items[].manDaySnapshot, company.region, createdBy, deal
 * @returns Flat object safe to pass to generateQuotationExcel
 */
export function adaptCrmQuotationForExcel(
  prismaQuotation: any,
): FlatQuotationForExcel {
  const sortedItems = _.sortBy(prismaQuotation.items, (i) => i.position);

  const flatItems: FlatQuotationItemForExcel[] = sortedItems.map((item, idx) => {
    const product = item.product;
    const service = item.service;
    const isProduct = item.itemType === "PRODUCT";
    const name = isProduct ? (product?.name ?? item.name) : (service?.name ?? item.name);
    // 2026-07-01 (US-IMPORT-SKU): SKU precedence for the Excel
    // export, in order:
    //   1. The per-line snapshot (`item.sku`) — set by the
    //      Quotation builder's "+ Service" / "+ 維護費用"
    //      buttons, and written back by the AI Excel re-import
    //      when the LLM extracts the source SKU. Admin can also
    //      override the snapshot inline.
    //   2. For PRODUCT lines: the catalogued `product.sku`.
    //   3. For SERVICE lines with an empty / whitespace
    //      snapshot: hardcoded Barco convention —
    //        - maintenance-fee line (by name) → "Barco-MA"
    //        - every other SERVICE line           → "Barco-PS"
    //      Tier 3 handles legacy data imported/built before the
    //      snapshot convention existed + AI imports where the
    //      LLM returned an empty sku string. The Barco SKU
    //      convention is permanent (the export round-trips
    //      faithfully with the bc-quotation template); no need
    //      to consult service.sku or admin-curated fields here.
    const deriveServiceSkuFallback = (): string => {
      if (/維護費用|維修費用|Maintenance\s+(Fee|Service)/i.test(item.name)) {
        return "Barco-MA";
      }
      return "Barco-PS";
    };
    const sku =
      (item.sku && item.sku.trim() !== "" ? item.sku : null) ??
      (isProduct ? (product?.sku ?? "") : deriveServiceSkuFallback());
    const unitPrice = Number(item.unitPrice);
    const qty = Number(item.quantity);
    const subtotal = Number(item.lineTotal);
    const discountPct = Number(item.discount);
    // Sales cost semantics:
    //   PRODUCT: salesCost = product.costPrice (per unit), subtotal = costPrice * qty
    //   SERVICE: CRM costSnapshot = costPerManDay * qty (整條 line cost),
    //            so salesCost = costSnapshot / qty (per-unit), subtotal = costSnapshot
    let salesCost: number;
    let salesCostSubtotal: number;
    if (isProduct) {
      salesCost = Number(product?.costPrice ?? 0);
      salesCostSubtotal = salesCost * qty;
    } else {
      const costSnapshot = Number(item.costSnapshot ?? 0);
      salesCost = qty > 0 ? costSnapshot / qty : 0;
      salesCostSubtotal = costSnapshot;
    }

    return {
      // 2026-06-07: index 1-based by position
      index: String(idx + 1),
      sector: deriveSector(item),
      is_included: "0", // 2026-06-07: CRM 冇 isIncluded field, 預設 0
      is_optional: Number(item.discount) > 0 ? "1" : "0", // heuristic: discount > 0 ≈ optional
      // 2026-06-07: discount > 0 唔一定代表 optional, 嚴格啲要 Product.sku === "OPT" 嘅 marker。
      //   暫時 heuristic, 之後 US-A6 加 isOptional field 再改。
      product_name: name,
      product_name_en: name, // CRM 冇分 z/en 兩版, 同 name
      qty,
      unit_price: unitPrice.toFixed(2),
      unit_price_v1: unitPrice.toFixed(2),
      subtotal: subtotal.toFixed(2),
      subtotal_v1: subtotal.toFixed(2),
      sku,
      sales_cost: salesCost.toFixed(2),
      sales_cost_subtotal: salesCostSubtotal.toFixed(2),
      sales_cost_v1: salesCost.toFixed(2),
      sales_cost_subtotal_v1: salesCostSubtotal.toFixed(2),
      // 2026-06-07: Barco-specific cost fields, 0 until US-A6 schema extension
      barco_sale_cost: 0,
      barco_sale_cost_subtotal: 0,
      adjustment_price: discountPct > 0 ? `-${unitPrice * (discountPct / 100)}` : 0,
      // 2026-06-07: notice / sow / assumption — empty until US-A6 schema extension
      notice: "",
      notice_en: "",
      // P2-Snapshot-Display (2026-06-26): prefer the snapshot
      // `item.description` (captured at line creation) over the live
      // catalogue's `service.description` / `product.description`. This
      // matches the detail-page precedence and means an old quotation
      // whose service/product was renamed or deleted still emits the
      // SOW the customer was originally quoted against. Same for sow_en.
      sow: item.description ?? service?.description ?? product?.description ?? "",
      sow_en: item.description ?? service?.description ?? product?.description ?? "",
      assumption: "",
      assumption_en: "",
    };
  });

  // region label: prefer bc-quotation-style "HK 香港" / "MO 澳門" / "CN 中國" / "OTHER 其他"
  const regionLabel = deriveRegionLabel(prismaQuotation.company);

  return {
    _createdAt: prismaQuotation.createdAt,
    auto_increment: prismaQuotation.number, // e.g., "Q-2026-0001" or "Q-2026-0001-R1"
    // 2026-06-26: standard versioning. The bc-quotation Excel
    // expects a string revision number (0 for original, "1",
    // "2", etc. for revisions). Pass the integer revisionNumber
    // straight through — its string coercion is what the
    // worksheet helper wants, and the value matches what's
    // embedded in `auto_increment` (the parent quotation vs.
    // the -R1 / -R2 suffix).
    revision: String(prismaQuotation.revisionNumber ?? 0),
    client_name: prismaQuotation.company.name,
    sales_name: prismaQuotation.createdBy.name,
    sales_email: prismaQuotation.createdBy.email,
    region: [{ value: regionLabel }], // bc shape
    project_name:
      prismaQuotation.title ?? prismaQuotation.deal?.title ?? "",
    total_price: Number(prismaQuotation.total),
    total_price_v1: Number(prismaQuotation.total),
    // P2 multi-currency (2026-06-29): thread the persisted
    // billing currency + HKD snapshot into the adapted shape
    // so the worksheet reads the chosen currency instead of
    // guessing from region (the old heuristic chose
    // "CNY"/"HKD"/"MOP" — wrong default for the new
    // RMB-default scheme). `total_price_hkd` is the row-level
    // HKD-equivalent that was persisted on the Quotation at
    // save time — we re-derive it from `total *
    // exchangeRateToHKD` as a belt-and-braces fallback for
    // legacy rows where the column is missing or 0.
    currency: prismaQuotation.currency ?? 'RMB',
    exchangeRateToHKD: Number(prismaQuotation.exchangeRateToHKD ?? 1),
    total_price_hkd:
      Number(prismaQuotation.totalHKD ?? 0) ||
      Number(prismaQuotation.total ?? 0) * Number(prismaQuotation.exchangeRateToHKD ?? 1),
    // 2026-06-29: MOP snapshot — same belt-and-braces fallback
    // pattern as HKD. Legacy rows (pre-MOP-snapshot migration)
    // have totalMOP = 0 and exchangeRateToMOP = 0; the
    // `total * rate` re-derive kicks in when totalMOP is 0 so
    // the worksheet never emits 0.00 MOP for a row that has a
    // known currency. Note: the re-derive uses the persisted
    // exchangeRateToMOP, which on legacy rows is also 0, so
    // legacy rows will emit 0.00 MOP — that's intentional, the
    // worksheet hides the MOP row when total_price_mop is 0.
    exchangeRateToMOP: Number(prismaQuotation.exchangeRateToMOP ?? 0),
    total_price_mop:
      Number(prismaQuotation.totalMOP ?? 0) ||
      Number(prismaQuotation.total ?? 0) * Number(prismaQuotation.exchangeRateToMOP ?? 0),
    sales_cost_total: flatItems.reduce(
      (s, i) => s + Number(i.sales_cost_subtotal),
      0,
    ),
    sales_cost_total_v1: flatItems.reduce(
      (s, i) => s + Number(i.sales_cost_subtotal_v1),
      0,
    ),
    barco_sales_total: flatItems.reduce(
      (s, i) => s + Number(i.barco_sale_cost_subtotal),
      0,
    ),
    QuotationItem: flatItems,
  };
}

/**
 * Derive region label in the bc-quotation format: "HK 香港" / "MO 澳門" / etc.
 * 2026-06-07: quotation_worksheet.ts hard-codes 3 currency mappings
 * (MO 澳門→MOP, HK 香港→HKD, 其他→CNY),所以 label 必須 match 返呢啲 string。
 */
function deriveRegionLabel(company: any): string {
  if (company.region) {
    // 2026-06-07: Region.code = "HK" / "MO" / "CN" / "OTHER"
    switch (company.region.code) {
      case "HK":
        return "HK 香港";
      case "MO":
        return "MO 澳門";
      case "CN":
        return "CN 中國";
      default:
        return "OTHER 其他";
    }
  }
  return company.customRegion ?? "OTHER 其他";
}

/**
 * Sector 決定 line item 點分組(quotation_worksheet 嘅 sector 邏輯):
 * 1.1 / 1.2 喺 sector "Hardware", 2.1 喺 sector "Software"。
 * 2026-06-07: 暫時按 itemType 設 sector 落 "Service" / "Product",後續
 * US-A6 schema extension 改用 Product.category 或 explicit field。
 */
function deriveSector(item: any): string {
  if (item.itemType === "SERVICE") return "Service";
  if (item.product?.category) return item.product.category;
  return "Product";
}
