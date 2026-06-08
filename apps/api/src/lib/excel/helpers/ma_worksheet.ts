import * as XLSXStyle from "xlsx-js-style";
import { WorkSheet } from "xlsx-js-style";
import path from "path";
import { fileURLToPath } from "url";

// 2026-06-07: 改成 ESM __dirname,bc-quotation 用 path.resolve("assets/...") 假設 cwd 係 project root。
// CRM API process.cwd() 喺 docker 唔一定係 project root, 所以用 __dirname 鎖定 assets folder。
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BORDER_STYLE = {
  top: { style: "thin", color: { rgb: "000000" } },
  bottom: { style: "thin", color: { rgb: "000000" } },
  left: { style: "thin", color: { rgb: "000000" } },
  right: { style: "thin", color: { rgb: "000000" } },
};

const isInBorderRange = (key: string): boolean => {
  const col = key.charCodeAt(0) - 64; // A=1, B=2, C=3, D=4
  const row = parseInt(key.slice(1));
  return col >= 1 && col <= 4 && row >= 1 && row <= 35;
};

// Ranges that use Wingdings 2 font: B2:D7, B12:D12, D13, B17:D23
const WINGDINGS2_RANGES: Array<{
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
}> = [
  { colStart: 2, colEnd: 4, rowStart: 2, rowEnd: 7 },
  { colStart: 2, colEnd: 4, rowStart: 12, rowEnd: 12 },
  { colStart: 4, colEnd: 4, rowStart: 13, rowEnd: 13 },
  { colStart: 2, colEnd: 4, rowStart: 17, rowEnd: 23 },
];

const isWingdings2Cell = (key: string): boolean => {
  const col = key.charCodeAt(0) - 64;
  const row = parseInt(key.slice(1));
  return WINGDINGS2_RANGES.some(
    (r) =>
      col >= r.colStart &&
      col <= r.colEnd &&
      row >= r.rowStart &&
      row <= r.rowEnd,
  );
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

export const maWorkSheet = (): WorkSheet => {
  const filePath = path.resolve(__dirname, "..", "assets", "ma_sow.xlsx");
  const workbook = XLSXStyle.readFile(filePath, { cellStyles: true });
  const sourceSheet = workbook.Sheets[workbook.SheetNames[0]];

  const worksheet: WorkSheet = {};

  for (const key of Object.keys(sourceSheet)) {
    if (key.startsWith("!")) {
      worksheet[key] = sourceSheet[key];
    } else {
      const cell = { ...sourceSheet[key] };
      const converted = cell.s ? convertRawStyle(cell.s) : {};
      if (isInBorderRange(key)) {
        converted.border = BORDER_STYLE;
      }
      if (isWingdings2Cell(key)) {
        converted.font = { name: "Wingdings 2" };
      }
      cell.s = converted;
      worksheet[key] = cell;
    }
  }

  return worksheet;
};
