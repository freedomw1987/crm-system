import _ from "lodash";
import moment from "moment";
import type { WorkSheet } from "xlsx-js-style";
import { setCellValue } from "./table";
import {
  titleStyle,
  borderStyle,
  tableCellStyle,
  tableHeaderStyle,
  salesCostCellStyle,
  itemTitleStyle,
} from "./table-style";

export const quotationWorkSheet = (
  quotation: any,
  lang: "en" | "zh",
  version: "v1" | "v2",
): WorkSheet => {
  const worksheet: WorkSheet = {};

  // 設置合併單元格
  worksheet["!merges"] = [];
  worksheet["!merges"].push(
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, // A1:F1 (row 0, col 0 to col 5)
  );
  setCellValue(worksheet, "A1", "BarcoAI - Quotation Supporting", titleStyle);

  // 第 3 行：報價日期和修訂
  setCellValue(worksheet, "B3", "Quotation Date:", { border: borderStyle });
  setCellValue(
    worksheet,
    "C3",
    moment(quotation?._createdAt).format("YYYY-MM-DD"),
    { border: borderStyle },
  );
  setCellValue(worksheet, "D3", "Revision", { border: borderStyle });
  setCellValue(worksheet, "E3", quotation?.revision, { border: borderStyle });

  // 第 4 行：參考編號
  setCellValue(worksheet, "B4", "Reference Number:", { border: borderStyle });
  setCellValue(worksheet, "C4", quotation?.auto_increment, {
    border: borderStyle,
  });

  // 第 6 行：客戶
  setCellValue(worksheet, "B6", "Customer:", { border: borderStyle });
  setCellValue(worksheet, "C6", quotation?.client_name, {
    border: borderStyle,
  });

  // 第 7 行：銷售人員和地區
  setCellValue(worksheet, "B7", "Account Sale:", { border: borderStyle });
  setCellValue(
    worksheet,
    "C7",
    `${quotation?.sales_name} <${quotation?.sales_email}>`,
    { border: borderStyle },
  );
  setCellValue(worksheet, "D7", "Sale Region", { border: borderStyle });
  setCellValue(worksheet, "E7", quotation?.region[0]?.value, {
    border: borderStyle,
  });

  // 第 8 行：貨幣
  // 2026-06-29 (P2 multi-currency): read the persisted billing
  // currency from the Quotation row, NOT a region-derived guess.
  // The old code always wrote "RMB" (which actually meant HKD
  // before multi-currency, and now RMB by default) regardless of
  // what the customer was quoted in. Carrying the persisted
  // value here means the printed quote matches the system of
  // record on every download.
  setCellValue(worksheet, "D8", "Currency", { border: borderStyle });
  setCellValue(worksheet, "E8", quotation?.currency ?? "RMB", {
    border: borderStyle,
  });

  // 第 10 行：表頭
  setCellValue(worksheet, "A10", "Item", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "f0f0f0" } },
  });
  setCellValue(worksheet, "B10", "Optional", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "f0f0f0" } },
  });
  setCellValue(worksheet, "C10", "Description", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "f0f0f0" } },
  });
  setCellValue(worksheet, "D10", "Unit Price", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "f0f0f0" } },
  });
  setCellValue(worksheet, "E10", "Quantity", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "f0f0f0" } },
  });
  setCellValue(worksheet, "F10", "Total Price", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "f0f0f0" } },
  });
  setCellValue(worksheet, "G10", "SKU Item", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "ffbf00" } },
  });
  setCellValue(worksheet, "H10", "Qty.", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "ffbf00" } },
  });
  setCellValue(worksheet, "I10", "Sales Cost", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "ffbf00" } },
  });
  setCellValue(worksheet, "J10", "Sales Cost Sub Total", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "ffbf00" } },
  });
  setCellValue(worksheet, "K10", "External Quotation/Ref. Number", {
    ...tableHeaderStyle,
    fill: { fgColor: { rgb: "ffbf00" } },
  });

  // 為 A1:F9 範圍內的空白單元格添加邊框
  const columns = ["A", "B", "C", "D", "E", "F"];
  for (let row = 1; row <= 9; row++) {
    for (const col of columns) {
      const cellRef = `${col}${row}`;
      if (!worksheet[cellRef]) {
        setCellValue(worksheet, cellRef, "", { border: borderStyle });
      }
    }
  }

  // 設置列寬
  worksheet["!cols"] = [
    { wpx: 50 }, // A 列
    { wpx: 100 }, // B 列寬度 100px
    { wpx: 250 }, // C 列
    { wpx: 80 }, // D 列
    { wpx: 80 }, // E 列
    { wpx: 80 }, // F 列
    { wpx: 100 }, // G 列
    { wpx: 50 }, // H 列
    { wpx: 80 }, // I 列
    { wpx: 120 }, // J 列
    { wpx: 180 }, // K 列
  ];

  // 第 13 行：項目 1
  let startRow = 11;
  addQuotationTableEmptyRow(worksheet, startRow++);
  addQuotationTableEmptyRow(worksheet, startRow++);
  // 第 11 行：項目標題
  setCellValue(worksheet, "C11", quotation?.project_name, itemTitleStyle);
  let sector = "";
  let sectorIndex = 0;
  let sectorRow = 1;

  _.each(quotation.QuotationItem, (quoItem: QuotationItemRowData) => {
    let index: string = "";
    if (quoItem?.sector !== "") {
      if (sector !== quoItem.sector) {
        addQuotationTableEmptyRow(worksheet, startRow);
        setCellValue(worksheet, `A${startRow}`, ++sectorIndex, {
          alignment: { horizontal: "center" },
        });
        setCellValue(worksheet, `C${startRow++}`, quoItem.sector, {
          font: { bold: true, color: { rgb: "ff0000" } },
        });
        sector = quoItem.sector;
        sectorRow = 1;
      }
      index = `${sectorIndex}.${sectorRow++}`;
    } else {
      index = ++sectorIndex + "";
    }
    addQuotationTableRow(
      worksheet,
      { ...quoItem, original_index: quoItem.index, index },
      startRow,
      lang,
      version,
      // P2 multi-currency (2026-06-29): per-row supplier-cost
      // label uses the persisted billing currency instead of a
      // region-derived guess. Falls back to "RMB" for legacy
      // rows that didn't have the field (should be rare — all
      // new rows carry it).
      quotation?.currency ?? "RMB",
    );

    if (quoItem?.sector === "") {
      worksheet[`C${startRow}`] = {
        ...worksheet[`C${startRow}`],
        ...{
          s: {
            font: { bold: true, color: { rgb: "ff0000" } },
          },
        },
      };
    }
    startRow += 3;
  });

  // 總計
  setCellValue(worksheet, `A${startRow}`, "Grand Total:", {
    ...tableCellStyle,
    font: { bold: true, sz: "12" },
    alignment: { horizontal: "right" },
  });
  setCellValue(worksheet, `B${startRow}`, "", tableCellStyle);
  setCellValue(worksheet, `C${startRow}`, "", tableCellStyle);
  setCellValue(worksheet, `D${startRow}`, "", tableCellStyle);
  setCellValue(worksheet, `E${startRow}`, "", tableCellStyle);
  setCellValue(
    worksheet,
    `F${startRow}`,
    version === "v2" ? +quotation?.total_price : +quotation?.total_price_v1,
    { ...tableCellStyle, font: { sz: "12", bold: true } },
    "$##,##0.00",
  );
  setCellValue(worksheet, `G${startRow}`, "Sales Cost Total:", {
    ...salesCostCellStyle,
    font: { sz: "12", bold: true },
    alignment: { horizontal: "right" },
  });
  setCellValue(worksheet, `H${startRow}`, "", salesCostCellStyle);
  setCellValue(worksheet, `I${startRow}`, "", salesCostCellStyle);
  setCellValue(
    worksheet,
    `J${startRow}`,
    version === "v2"
      ? quotation?.barco_sales_total
        ? +quotation?.barco_sales_total
        : +quotation?.sales_cost_total
      : +quotation?.sales_cost_total_v1,
    {
      ...salesCostCellStyle,
      font: { sz: "12", bold: true },
      fill: { fgColor: { rgb: "ffbf00" } },
    },
    "$##,##0.00",
  );
  setCellValue(worksheet, `K${startRow}`, "", salesCostCellStyle);

  // P2 multi-currency (2026-06-29): append an HKD-equivalent row
  // immediately under the Grand Total so the printed quote shows
  // the customer's HKD-management number alongside the native
  // total. Only emitted when the chosen currency isn't HKD
  // (showing HKD ↔ HKD on the same line is noise).
  if (quotation?.currency && quotation.currency !== "HKD") {
    const hkdRow = startRow + 1;
    setCellValue(worksheet, `A${hkdRow}`, `≈ HKD (rate ${(Number(quotation?.exchangeRateToHKD ?? 0)).toFixed(4)}):`, {
      ...tableCellStyle,
      font: { sz: "11", italic: true, color: { rgb: "595959" } },
      alignment: { horizontal: "right" },
    });
    setCellValue(worksheet, `B${hkdRow}`, "", tableCellStyle);
    setCellValue(worksheet, `C${hkdRow}`, "", tableCellStyle);
    setCellValue(worksheet, `D${hkdRow}`, "", tableCellStyle);
    setCellValue(worksheet, `E${hkdRow}`, "", tableCellStyle);
    setCellValue(
      worksheet,
      `F${hkdRow}`,
      Number(quotation?.total_price_hkd ?? 0),
      { ...tableCellStyle, font: { sz: "11", italic: true, color: { rgb: "595959" } } },
      "$##,##0.00",
    );
    // Mirror the Grand-Total merges for visual continuity.
    worksheet["!merges"].push({
      s: { r: hkdRow - 1, c: 0 },
      e: { r: hkdRow - 1, c: 4 },
    });
    worksheet["!merges"].push({
      s: { r: hkdRow - 1, c: 6 },
      e: { r: hkdRow - 1, c: 8 },
    });
  }

  worksheet["!merges"].push({
    s: { r: startRow - 1, c: 0 },
    e: { r: startRow - 1, c: 4 },
  });
  worksheet["!merges"].push({
    s: { r: startRow - 1, c: 6 },
    e: { r: startRow - 1, c: 8 },
  });

  // // 設置工作表範圍
  // P2 multi-currency (2026-06-29): if we appended an HKD row it
  // sits on `startRow + 1`; extend the worksheet ref so the row
  // is included in any "print area" calculations.
  const endRow =
    quotation?.currency && quotation.currency !== "HKD" ? startRow + 1 : startRow;
  worksheet["!ref"] = `A1:K${endRow}`;

  return worksheet;
};

export type QuotationItemRowData = {
  index: string;
  sector: string;
  is_included: "0" | "1";
  is_optional: "0" | "1";
  product_name: string;
  product_name_name: string;
  qty: string;
  unit_price: string;
  subtotal: string;
  sku: string;
  sales_cost: string;
  sales_cost_total: string;
  barco_sales_cost: string;
  barco_sales_cost_subtotal: string;
  notice: string;
  sow: string;
  assumption: string;
  [key: string]: any;
};

export const addQuotationTableRow = (
  worksheet: WorkSheet,
  row: QuotationItemRowData,
  rowIndex: number,
  lang: "en" | "zh",
  version: "v1" | "v2",
  currency: string = "MOP",
) => {
  // 第 13 行：項目 1
  setCellValue(worksheet, `A${rowIndex}`, row.index, {
    ...tableCellStyle,
    alignment: { horizontal: "center" },
  });
  setCellValue(
    worksheet,
    `B${rowIndex}`,
    row.is_optional === "1" ? "Optional" : "",
    tableCellStyle,
  );
  setCellValue(
    worksheet,
    `C${rowIndex}`,
    lang === "en" ? row.product_name_en : row.product_name,
    {
      ...tableCellStyle,
      ...itemTitleStyle,
    },
  );

  setCellValue(
    worksheet,
    `D${rowIndex}`,
    row.is_included === "1"
      ? Math.abs(+row.adjustment_price)
      : version === "v2"
        ? +row.unit_price
        : +row.unit_price_v1,
    tableCellStyle,
    "$##,##0.00",
  );
  setCellValue(worksheet, `E${rowIndex}`, row.qty, {
    ...tableCellStyle,
    alignment: { horizontal: "center" },
  });
  setCellValue(
    worksheet,
    `F${rowIndex}`,
    row.is_included === "1" || row.is_optional === "1"
      ? "--"
      : version === "v2"
        ? +row.subtotal
        : +row.subtotal_v1,
    tableCellStyle,
  );
  setCellValue(worksheet, `G${rowIndex}`, row.sku, {
    ...salesCostCellStyle,
    alignment: { horizontal: "center" },
  });
  setCellValue(worksheet, `H${rowIndex}`, row.qty, {
    ...salesCostCellStyle,
    alignment: { horizontal: "center" },
  });
  setCellValue(
    worksheet,
    `I${rowIndex}`,
    version === "v2"
      ? row.barco_sale_cost
        ? +row.barco_sale_cost
        : +row.sales_cost
      : +row.sales_cost_v1,
    salesCostCellStyle,
    "$##,##0.00",
  );
  setCellValue(
    worksheet,
    `J${rowIndex}`,
    version === "v2"
      ? row.barco_sale_cost_subtotal
        ? +row.barco_sale_cost_subtotal
        : +row.sales_cost_subtotal
      : +row.sales_cost_subtotal_v1,
    {
      ...salesCostCellStyle,
      fill: { fgColor: { rgb: "ffbf00" } },
    },
    "$##,##0.00",
  );
  setCellValue(
    worksheet,
    `K${rowIndex}`,
    row.sku === "by Sales"
      ? `供應商報價 ${currency} ${row.sales_cost.toLocaleString()}`
      : "",
    salesCostCellStyle,
  );

  rowIndex += 1;
  //notice 行
  setCellValue(worksheet, `A${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `B${rowIndex}`, "", tableCellStyle);
  const notice =
    row.sku === "Barco-MA"
      ? []
      : [`<Ref. to SOW Detail - Item ${row.original_index}>`];
  if (lang === "en") {
    if (row?.notice_en) notice.unshift(row.notice_en);
  } else {
    if (row?.notice) notice.unshift(row.notice);
  }
  setCellValue(
    worksheet,
    `C${rowIndex}`,
    notice.join("\n"),

    { ...tableCellStyle, alignment: { wrapText: true, verical: "top" } },
  );
  setCellValue(worksheet, `D${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `E${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `F${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `G${rowIndex}`, "", salesCostCellStyle);
  setCellValue(worksheet, `H${rowIndex}`, "", salesCostCellStyle);
  setCellValue(worksheet, `I${rowIndex}`, "", salesCostCellStyle);
  setCellValue(worksheet, `J${rowIndex}`, "", {
    ...salesCostCellStyle,
    fill: { fgColor: { rgb: "ffbf00" } },
  });
  setCellValue(worksheet, `K${rowIndex}`, "", salesCostCellStyle);

  addQuotationTableEmptyRow(worksheet, rowIndex + 1);
};

export const addQuotationTableEmptyRow = (
  worksheet: WorkSheet,
  rowIndex: number,
) => {
  setCellValue(worksheet, `A${rowIndex}`, "", {
    ...tableCellStyle,
    alignment: { horizontal: "center" },
  });
  setCellValue(worksheet, `B${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `C${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `D${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `E${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `F${rowIndex}`, "", tableCellStyle);
  setCellValue(worksheet, `G${rowIndex}`, "", salesCostCellStyle);
  setCellValue(worksheet, `H${rowIndex}`, "", salesCostCellStyle);
  setCellValue(worksheet, `I${rowIndex}`, "", salesCostCellStyle);
  setCellValue(worksheet, `J${rowIndex}`, "", {
    ...salesCostCellStyle,
    fill: { fgColor: { rgb: "ffbf00" } },
  });
  setCellValue(worksheet, `K${rowIndex}`, "", salesCostCellStyle);
};
