/**
 * Unit tests for crm-adapter → bc-quotation shape conversion.
 * 2026-06-07 (US-A5, RG-2026-06-07-EXPORT-XLSX):
 *   Snapshots the shape of `adaptCrmQuotationForExcel` for 3 fixture scenarios
 *   to lock in the field names / units that the 5 worksheet helpers consume.
 *   If a future refactor renames a field, the snapshot will fail and force
 *   the author to update it explicitly.
 */
import { describe, expect, test } from "bun:test";
import { adaptCrmQuotationForExcel } from "./crm-adapter";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeBaseQuotation(overrides: any = {}): any {
  return {
    id: "cuid_q1",
    number: "Q-2026-0001",
    title: "Acme AI Upgrade",
    total: 150000,
    currency: "HKD",
    createdAt: new Date("2026-06-07T10:00:00Z"),
    company: {
      name: "Acme Corp",
      region: { code: "HK", name: "Hong Kong" },
    },
    createdBy: { id: "u1", name: "David Chu", email: "david@example.com" },
    deal: { title: "Acme AI Q3 Deal" },
    items: [],
    ...overrides,
  };
}

function productItem(overrides: any = {}): any {
  return {
    id: "item_p1",
    itemType: "PRODUCT",
    name: "ClickShare CX-50",
    product: { sku: "Barco-CX-50", name: "ClickShare CX-50", category: "Hardware", costPrice: 8000 },
    service: null,
    quantity: 2,
    unitPrice: 12000,
    discount: 0,
    lineTotal: 24000,
    costSnapshot: 0,
    position: 0,
    ...overrides,
  };
}

function serviceItem(overrides: any = {}): any {
  return {
    id: "item_s1",
    itemType: "SERVICE",
    name: "Senior Engineer Implementation",
    product: null,
    service: { name: "Senior Engineer Implementation", description: "10 days" },
    quantity: 10,
    unitPrice: 5000,
    discount: 0,
    lineTotal: 50000,
    // CRM stores costSnapshot = costPerManDay * qty. For 10 days at
    // 300 costRate/man-day → costSnapshot = 3000.
    costSnapshot: 3000,
    position: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptCrmQuotationForExcel", () => {
  test("header: maps Prisma fields → bc-quotation top-level fields", () => {
    const q = makeBaseQuotation();
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.auto_increment).toBe("Q-2026-0001"); // uses quotation.number as file-name-equivalent
    expect(flat.client_name).toBe("Acme Corp");
    expect(flat.sales_name).toBe("David Chu");
    expect(flat.sales_email).toBe("david@example.com");
    expect(flat.region).toEqual([{ value: "HK 香港" }]); // bc-quotation region label
    expect(flat.project_name).toBe("Acme AI Upgrade");
    expect(flat.total_price).toBe(150000);
    expect(flat._createdAt).toBeInstanceOf(Date);
    expect(flat.revision).toBe("0"); // CRM 冇 revision, 預設 0
  });

  test("P2 multi-currency (2026-06-29): thread currency + HKD snapshot", () => {
    // Persisted currency + rate + totalHKD should pass through 1:1
    // so the worksheet reads the customer's chosen currency, not
    // a region-derived guess.
    const q = makeBaseQuotation({
      currency: "RMB",
      exchangeRateToHKD: 1.08,
      totalHKD: 162000, // 150000 * 1.08
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.currency).toBe("RMB");
    expect(flat.exchangeRateToHKD).toBe(1.08);
    expect(flat.total_price_hkd).toBe(162000);
  });

  test("P2 multi-currency: total_price_hkd falls back to total * rate when persisted totalHKD is missing (legacy rows)", () => {
    // Pre-migration rows have totalHKD=0 (backfill coped with HKD-
    // denominated rows where totalHKD == total, but if a row was
    // somehow missed the fallback should re-derive it from the
    // rate so the worksheet doesn't emit 0.00 HKD).
    const q = makeBaseQuotation({
      currency: "MOP",
      exchangeRateToHKD: 0.931, // 1.08 / 1.16
      totalHKD: 0,
    });
    const flat = adaptCrmQuotationForExcel(q);
    // 150000 * 0.931 = 139650 (approx, re-derived from rate)
    expect(flat.total_price_hkd).toBeCloseTo(150000 * 0.931, 2);
  });

  test("P2 multi-currency (2026-06-29): thread currency + MOP snapshot", () => {
    // Mirrors the HKD test above. Persisted MOP rate + totalMOP
    // should pass through 1:1 so the worksheet renders the MOP-
    // equivalent row using the persisted snapshot, not a live
    // recompute (which would silently rewrite history when the
    // admin later edits the rates in /settings/currency).
    const q = makeBaseQuotation({
      currency: "RMB",
      exchangeRateToMOP: 1.16,
      totalMOP: 174000, // 150000 * 1.16
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.currency).toBe("RMB");
    expect(flat.exchangeRateToMOP).toBe(1.16);
    expect(flat.total_price_mop).toBe(174000);
  });

  test("P2 multi-currency: total_price_mop falls back to total * rate when persisted totalMOP is missing (pre-MOP-snapshot legacy rows)", () => {
    // Pre-MOP-snapshot rows have totalMOP = 0 and exchangeRateToMOP = 0.
    // The fallback `total * rate` won't help (rate is also 0), so the
    // worksheet should emit 0 MOP — and the worksheet helper hides the
    // MOP row when total_price_mop == 0. This test just locks in the
    // adapter's behavior so a future refactor doesn't accidentally
    // invent a fake MOP value for legacy rows.
    const q = makeBaseQuotation({
      currency: "HKD",
      exchangeRateToMOP: 0,
      totalMOP: 0,
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.total_price_mop).toBe(0);
  });

  test("region label: maps all 4 Region.code values to bc-quotation labels", () => {
    for (const [code, expected] of [
      ["HK", "HK 香港"],
      ["MO", "MO 澳門"],
      ["CN", "CN 中國"],
      ["OTHER", "OTHER 其他"],
    ] as const) {
      const q = makeBaseQuotation({ company: { name: "X", region: { code, name: code } } });
      const flat = adaptCrmQuotationForExcel(q);
      expect(flat.region[0].value).toBe(expected);
    }
  });

  test("region label: falls back to 'OTHER 其他' when region FK is null", () => {
    const q = makeBaseQuotation({ company: { name: "X", region: null, customRegion: null } });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.region[0].value).toBe("OTHER 其他");
  });

  test("PRODUCT line: salesCost = product.costPrice, subtotal = costPrice * qty", () => {
    const q = makeBaseQuotation({ items: [productItem()] });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem).toHaveLength(1);
    const item = flat.QuotationItem[0];
    expect(item.sku).toBe("Barco-CX-50");
    expect(item.product_name).toBe("ClickShare CX-50");
    expect(Number(item.sales_cost)).toBe(8000);
    expect(Number(item.sales_cost_subtotal)).toBe(16000); // 8000 * 2
    expect(Number(item.subtotal)).toBe(24000);
    expect(item.is_included).toBe("0");
  });

  test("SERVICE line: salesCost = costSnapshot / qty, subtotal = costSnapshot", () => {
    const q = makeBaseQuotation({ items: [serviceItem()] });
    const flat = adaptCrmQuotationForExcel(q);
    const item = flat.QuotationItem[0];
    // 2026-06-07: services have no SKU in CRM, so we leave it blank
    // (avoids emitting fake "SVC-xxx" data into the Excel).
    expect(item.sku).toBe("");
    // costSnapshot=3000, qty=10 → salesCost (per-man-day) = 300
    expect(Number(item.sales_cost)).toBe(300);
    // sales_cost_subtotal (whole-line cost) = costSnapshot = 3000
    expect(Number(item.sales_cost_subtotal)).toBe(3000);
    expect(item.sow).toBe("10 days"); // pulled from service.description
  });

  test("SERVICE line: prevents qty=0 division-by-zero", () => {
    const q = makeBaseQuotation({ items: [serviceItem({ quantity: 0, lineTotal: 0, costSnapshot: 0 })] });
    const flat = adaptCrmQuotationForExcel(q);
    expect(Number(flat.QuotationItem[0].sales_cost)).toBe(0);
    expect(Number(flat.QuotationItem[0].sales_cost_subtotal)).toBe(0);
  });

  test("mixed: aggregates sales_cost_total across product + service", () => {
    const q = makeBaseQuotation({ items: [productItem(), serviceItem()] });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem).toHaveLength(2);
    // 16000 (product) + 3000 (service line subtotal) = 19000
    expect(flat.sales_cost_total).toBe(19000);
  });

  test("is_optional heuristic: discount > 0 → '1'", () => {
    const q = makeBaseQuotation({
      items: [productItem({ discount: 10, lineTotal: 21600, unitPrice: 12000 })],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].is_optional).toBe("1");
  });

  test("is_optional: discount = 0 → '0'", () => {
    const q = makeBaseQuotation({ items: [productItem()] });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].is_optional).toBe("0");
  });

  test("index: 1-based by position, sorted", () => {
    const a = productItem({ id: "a", position: 2 });
    const b = serviceItem({ id: "b", position: 0 });
    const c = productItem({ id: "c", position: 1 });
    const q = makeBaseQuotation({ items: [a, b, c] });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem.map((i) => i.index)).toEqual(["1", "2", "3"]);
    // After sorting by position: b (svc, pos=0) → c (prod, pos=1) → a (prod, pos=2)
    expect(flat.QuotationItem[0].sku).toBe(""); // b: service → blank
    expect(flat.QuotationItem[1].sku).toBe("Barco-CX-50"); // c
    expect(flat.QuotationItem[2].sku).toBe("Barco-CX-50"); // a
  });

  test("PRODUCT line: SOW falls back to live product.description when snapshot is empty", () => {
    const q = makeBaseQuotation({
      items: [
        productItem({
          description: null,
          product: {
            sku: "Barco-CX-50",
            name: "ClickShare CX-50",
            category: "Hardware",
            costPrice: 8000,
            description: "Includes 1-year hardware warranty",
          },
        }),
      ],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sow).toBe("Includes 1-year hardware warranty");
  });

  test("PRODUCT line: snapshot description wins over live product.description (renamed catalogue)", () => {
    // The customer was quoted against "ClickShare CX-50 (legacy SKU)";
    // the product was later renamed to "ClickShare CX-50 Gen2" with a
    // new description. The Excel must still emit the snapshot — that's
    // what the customer signed.
    const q = makeBaseQuotation({
      items: [
        productItem({
          description: "ClickShare CX-50 (legacy SKU)",
          product: {
            sku: "Barco-CX-50",
            name: "ClickShare CX-50 Gen2",
            category: "Hardware",
            costPrice: 8000,
            description: "Includes 3-year warranty",
          },
        }),
      ],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sow).toBe("ClickShare CX-50 (legacy SKU)");
  });

  test("PRODUCT line: snapshot survives product deletion (live relation is null)", () => {
    // The product was deleted; QuotationItem.productId was SetNull'd,
    // but `item.description` (snapshot) is preserved.
    const q = makeBaseQuotation({
      items: [
        productItem({
          description: "Archived product — sold as-is",
          product: null,
        }),
      ],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sow).toBe("Archived product — sold as-is");
  });

  test("SERVICE line: snapshot description wins over live service.description", () => {
    const q = makeBaseQuotation({
      items: [
        serviceItem({
          description: "Senior Engineer · 10 days · deliverable: SOW doc v2",
          service: { name: "Senior Engineer Implementation", description: "Live description" },
        }),
      ],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sow).toBe(
      "Senior Engineer · 10 days · deliverable: SOW doc v2",
    );
  });

  test("SERVICE line: snapshot survives service deletion (live relation is null)", () => {
    const q = makeBaseQuotation({
      items: [
        serviceItem({
          description: "Implements the customer's SOW as agreed",
          service: null,
        }),
      ],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sow).toBe(
      "Implements the customer's SOW as agreed",
    );
  });

  test("SERVICE line: SOW is empty when no description is available at any layer", () => {
    const q = makeBaseQuotation({
      items: [serviceItem({ description: null, service: null })],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sow).toBe("");
    expect(flat.QuotationItem[0].sow_en).toBe("");
  });

  test("gap fields: notice/assumption/barco_sale_cost hard-coded (US-A6 will fix)", () => {
    // 2026-06-07: these are BoardPro-only fields, CRM has no equivalent yet.
    //   We document the hard-coded values so a future US-A6 PR can find them.
    const q = makeBaseQuotation({ items: [productItem(), serviceItem()] });
    const flat = adaptCrmQuotationForExcel(q);
    for (const item of flat.QuotationItem) {
      expect(item.notice).toBe("");
      expect(item.notice_en).toBe("");
      expect(item.assumption).toBe("");
      expect(item.assumption_en).toBe("");
      expect(item.barco_sale_cost).toBe(0);
      expect(item.barco_sale_cost_subtotal).toBe(0);
      expect(item.is_included).toBe("0");
    }
  });

  // 2026-07-01 (US-IMPORT-SKU): SKU precedence for the Barco
  // round-trip. The Quotation builder sets `item.sku` when
  // creating SERVICE / "+ 維護費用" lines (snapshot SKU),
  // and the export must honour that snapshot. Legacy SERVICE
  // lines without a snapshot still emit "" so we don't
  // synthesise fake data.
  test("SERVICE line: uses item.sku snapshot over the catalogue", () => {
    const q = makeBaseQuotation({
      items: [serviceItem({ sku: "Barco-PS" })],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sku).toBe("Barco-PS");
  });

  test("SERVICE line: maintenance fee SKU (Barco-MA) round-trips", () => {
    const q = makeBaseQuotation({
      items: [serviceItem({
        name: "維護費用 / Maintenance Service",
        sku: "Barco-MA",
        quantity: 1,
        unitPrice: 20000,
        lineTotal: 20000,
      })],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sku).toBe("Barco-MA");
  });

  test("SERVICE line: empty sku snapshot stays empty (legacy data)", () => {
    // services with no snapshot should NOT get a synthesised
    // catalogue SKU — see crm-adapter.ts:97 comment.
    const q = makeBaseQuotation({ items: [serviceItem()] });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sku).toBe("");
  });

  test("PRODUCT line: item.sku snapshot wins over product.sku", () => {
    const q = makeBaseQuotation({
      items: [productItem({ sku: "CUSTOM-SKU-FROM-SNAPSHOT" })],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sku).toBe("CUSTOM-SKU-FROM-SNAPSHOT");
  });

  test("PRODUCT line: falls back to product.sku when snapshot missing", () => {
    const q = makeBaseQuotation({
      items: [productItem({ sku: undefined })],
    });
    const flat = adaptCrmQuotationForExcel(q);
    expect(flat.QuotationItem[0].sku).toBe("Barco-CX-50");
  });
});
