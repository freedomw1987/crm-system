import * as XLSXStyle from "xlsx-js-style";
import { WorkSheet } from "xlsx-js-style";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BORDER_STYLE = {
  top: { style: "thin", color: { rgb: "000000" } },
  bottom: { style: "thin", color: { rgb: "000000" } },
  left: { style: "thin", color: { rgb: "000000" } },
  right: { style: "thin", color: { rgb: "000000" } },
};

const convertRawStyle = (raw: Record<string, any>) => {
  const style: Record<string, any> = {};

  if (raw.patternType) {
    style.fill = {
      patternType: raw.patternType,
      ...(raw.fgColor && { fgColor: raw.fgColor }),
      ...(raw.bgColor && { bgColor: raw.bgColor }),
    };
  }

  if (raw.font) style.font = raw.font;
  if (raw.border) style.border = raw.border;
  if (raw.alignment) style.alignment = raw.alignment;
  if (raw.numFmt) style.numFmt = raw.numFmt;

  return style;
};

/**
 * Load a sheet from an xlsx file, converting styles and applying borders.
 * Returns cells with keys using row numbers offset by `rowOffset`.
 * Also returns the original row count and metadata arrays.
 */
const loadSheet = (
  filePath: string,
  rowOffset: number,
): {
  cells: Record<string, any>;
  rowCount: number;
  colCount: number;
  cols: any[];
  rows: any[];
} => {
  const workbook = XLSXStyle.readFile(filePath, { cellStyles: true });
  const sourceSheet = workbook.Sheets[workbook.SheetNames[0]];

  const ref = sourceSheet["!ref"] as string;
  const range = XLSXStyle.utils.decode_range(ref);
  const rowCount = range.e.r + 1; // 1-based count
  const colCount = range.e.c + 1;

  const cells: Record<string, any> = {};

  for (const key of Object.keys(sourceSheet)) {
    if (key.startsWith("!")) continue;

    const col = key.charCodeAt(0) - 64;
    const originalRow = parseInt(key.slice(1));
    const newRow = originalRow + rowOffset;
    const newKey = String.fromCharCode(col + 64) + newRow;

    const cell = { ...sourceSheet[key] };
    const converted = cell.s ? convertRawStyle(cell.s) : {};
    converted.border = BORDER_STYLE;
    cell.s = converted;
    cells[newKey] = cell;
  }

  return {
    cells,
    rowCount,
    colCount,
    cols: sourceSheet["!cols"] ?? [],
    rows: sourceSheet["!rows"] ?? [],
  };
};

export const serverRequirementsWorkSheet = (
  includeTM: boolean,
  includeOCDP: boolean,
): WorkSheet => {
  const worksheet: WorkSheet = {};
  let currentRow = 0;
  let totalRows = 0;
  let maxCols = 0;
  const mergedCols: any[] = [];
  const mergedRows: any[] = [];

  if (includeTM) {
    const tm = loadSheet(
      path.resolve(__dirname, "..", "assets", "terraMind_server.xlsx"),
      currentRow,
    );
    Object.assign(worksheet, tm.cells);
    currentRow += tm.rowCount;
    totalRows += tm.rowCount;
    maxCols = Math.max(maxCols, tm.colCount);
    // Use TM col widths as base
    for (let i = 0; i < tm.cols.length; i++) {
      mergedCols[i] = tm.cols[i];
    }
    for (let i = 0; i < tm.rows.length; i++) {
      mergedRows[i] = tm.rows[i];
    }
  }

  if (includeOCDP) {
    if (currentRow > 0) {
      // Insert a blank separator row
      currentRow += 1;
      totalRows += 1;
      mergedRows[currentRow - 1] = null;
    }

    const ocdp = loadSheet(
      path.resolve(__dirname, "..", "assets", "OCDP_server.xlsx"),
      currentRow,
    );
    Object.assign(worksheet, ocdp.cells);
    totalRows += ocdp.rowCount;
    maxCols = Math.max(maxCols, ocdp.colCount);
    // Merge col widths: prefer existing (TM), fall back to OCDP
    for (let i = 0; i < ocdp.cols.length; i++) {
      if (!mergedCols[i]) mergedCols[i] = ocdp.cols[i];
    }
    // Append OCDP row heights at their new positions
    for (let i = 0; i < ocdp.rows.length; i++) {
      mergedRows[currentRow + i] = ocdp.rows[i];
    }
  }

  const lastCol = String.fromCharCode(64 + maxCols);
  worksheet["!ref"] = `A1:${lastCol}${totalRows}`;
  worksheet["!cols"] = mergedCols;
  worksheet["!rows"] = mergedRows;

  return worksheet;
};

// Keep the original export for backward compatibility
export const terraMindWorkSheet = (): WorkSheet =>
  serverRequirementsWorkSheet(true, false);
