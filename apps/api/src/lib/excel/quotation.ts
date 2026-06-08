import * as XLSX from "xlsx-js-style";
import _ from "lodash";
// helpers
import { quotationWorkSheet } from "./helpers/quotation_worksheet";
import { sowWorkSheet } from "./helpers/sow_worksheet";
import { assumptionWorkSheet } from "./helpers/assumption_worksheet";
import { maWorkSheet } from "./helpers/ma_worksheet";
import { serverRequirementsWorkSheet } from "./helpers/server_worksheet";

/**
 * 生成報價單 Excel
 * 2026-06-07: 由 bc-quotation/src/quotation.ts 1:1 port 入 CRM, caller 要 pre-flatten
 * Prisma 嘅 Quotation + QuotationItem shape 落呢個 function 期望嘅 shape
 * (見 crm-adapter.ts)。
 */
export function generateQuotationExcel(
  quotation: any,
  lang: "en" | "zh",
  version: "v1" | "v2",
) {
  // 創建工作簿和工作表
  const workbook = XLSX.utils.book_new();
  // 將 Quotation 工作表添加到工作簿
  const worksheet = quotationWorkSheet(quotation, lang, version);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Quotation");

  // 創建 SOW Details 工作表
  const sowWorksheet = sowWorkSheet(quotation, lang);
  XLSX.utils.book_append_sheet(workbook, sowWorksheet, "SOW Details");

  // 創建 Assumption 工作表
  const assumptionWorksheet = assumptionWorkSheet(quotation, lang);
  XLSX.utils.book_append_sheet(workbook, assumptionWorksheet, "Assumption");

  // 創建MA 工作表
  if (_.some(quotation.QuotationItem, (i) => i.sku === "Barco-MA")) {
    const maWorksheet = maWorkSheet();
    XLSX.utils.book_append_sheet(workbook, maWorksheet, "MA Details");
  }
  // 創建TerraMind Server Requirements 工作表
  if (
    _.some(
      quotation.QuotationItem,
      (i) => i.sku === "Barco-LIC-TM" || i.sku === "Barco-LIC-OCDP",
    )
  ) {
    const srWorksheet = serverRequirementsWorkSheet(
      _.some(quotation.QuotationItem, (i) => i.sku === "Barco-LIC-TM"),
      _.some(quotation.QuotationItem, (i) => i.sku === "Barco-LIC-OCDP"),
    );
    XLSX.utils.book_append_sheet(workbook, srWorksheet, "Server Requirements");
  }

  // 生成 Excel buffer（啟用樣式支持）
  const excelBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    cellStyles: true,
  });

  return excelBuffer;
}

/**
 * 處理下載請求，返回 Response 對象
 * 2026-06-07: 從 bc-quotation port, 不再 hit BoardPro, 純粹 wrap 落 `generateQuotationExcel`。
 * Caller (route handler) 已經從 Prisma 攞好 quotation + adapter 處理好 shape。
 */
export const handleDownload = async ({
  rowid, // 2026-06-07: rename-agnostic, 保留 parameter 名做 backward compat
  quotation,
  lang = "zh",
  version = "v2",
}: {
  rowid?: string;
  quotation: any;
  lang?: "en" | "zh";
  version?: "v1" | "v2";
}) => {
  // 2026-06-07: 不再 .replace(".xlsx") 因為 caller 已經係 Prisma id (cuid) 或者 quotation.number。
  //   留呢行 no-op comment 提示 caller 唔好再行呢個 heuristic。
  void rowid;
  const excelBuffer = generateQuotationExcel(quotation, lang, version);
  return new Response(excelBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 2026-06-07: file 名由 route handler 處理, 呢度只係 fallback。
      "Content-Disposition": `attachment; filename="${quotation?.auto_increment ?? "quotation"}.xlsx"`,
    },
  });
};
