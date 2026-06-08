/**
 * Smoke test for crm-adapter → generateQuotationExcel → .xlsx buffer
 * 2026-06-07: David 確認 sheet structure 對唔對嘅 first-look.
 *
 * 用 mock data 模擬 1 個 product line + 1 個 service line, 唔 hit DB,
 * 拎出 .xlsx buffer, 寫去 /tmp/quotation-smoke.xlsx 等 David 開嚟睇。
 */
import { writeFileSync } from "fs";
import { adaptCrmQuotationForExcel } from "./crm-adapter";
import { generateQuotationExcel } from "./quotation";

// Mock Prisma Quotation shape (符合 crm-adapter 嘅型別要求)
const mockQuotation: any = {
  id: "cuid_mock_001",
  number: "Q-2026-0001",
  title: "Test Project — Acme Corp AI Upgrade",
  total: 150000,
  currency: "HKD",
  createdAt: new Date("2026-06-07T10:00:00Z"),
  company: {
    name: "Acme Corp",
    region: { code: "HK", name: "Hong Kong" },
  },
  createdBy: {
    id: "user_001",
    name: "David Chu",
    email: "david.chu@example.com",
  },
  deal: { name: "Acme AI Q3 Deal" },
  items: [
    {
      id: "item_001",
      itemType: "PRODUCT",
      name: "Barco ClickShare CX-50",
      product: {
        sku: "Barco-CX-50",
        name: "ClickShare CX-50",
        category: "Hardware",
        costPrice: 8000,
      },
      service: null,
      quantity: 2,
      unitPrice: 12000,
      discount: 0,
      lineTotal: 24000,
      costSnapshot: 0,
      position: 0,
    },
    {
      id: "item_002",
      itemType: "SERVICE",
      name: "Senior Engineer Implementation",
      product: null,
      service: {
        name: "Senior Engineer Implementation",
        description:
          "10 days of senior engineering work: setup, integration, training.\nDeliverable: working system + handoff docs.",
      },
      quantity: 10,
      unitPrice: 5000,
      discount: 0,
      lineTotal: 50000,
      costSnapshot: 30000, // already (costRate * days) * qty
      position: 1,
    },
  ],
};

const flat = adaptCrmQuotationForExcel(mockQuotation);
console.log("--- FLATTENED QUOTATION ---");
console.log(JSON.stringify(flat, null, 2));

const buf = generateQuotationExcel(flat, "zh", "v2");
writeFileSync("/tmp/quotation-smoke.xlsx", buf);
console.log(`\n✅ Wrote /tmp/quotation-smoke.xlsx (${buf.length} bytes)`);
console.log(`   File: open /tmp/quotation-smoke.xlsx in Numbers / Excel to verify 5 sheets.`);
