import { WorkSheet } from "xlsx-js-style";

/**
 * 輔助函數：設置單元格值
 */
export const setCellValue = (
  worksheet: WorkSheet,
  cell: string,
  value: any,
  style?: any,
  numberFormat?: string,
) => {
  const cellObj: any = {};

  if (typeof value === "number") {
    cellObj.v = value;
    cellObj.t = "n";
    if (numberFormat) cellObj.z = numberFormat;
  } else if (typeof value === "string") {
    cellObj.v = value;
    cellObj.t = "s";
  } else {
    cellObj.v = value;
    cellObj.t = "s";
  }

  // 添加樣式
  if (style) {
    cellObj.s = style;
  }

  worksheet[cell] = cellObj;
};
