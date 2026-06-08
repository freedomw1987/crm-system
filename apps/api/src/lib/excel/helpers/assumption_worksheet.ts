import _ from "lodash";
import type { WorkSheet } from "xlsx-js-style";
import { setCellValue } from "./table";
import { tableCellStyle, tableHeaderStyle } from "./table-style";

export const assumptionWorkSheet = (
  quotation: any,
  lang: "en" | "zh",
): WorkSheet => {
  const worksheet: WorkSheet = {};

  const assumptionRowList = _.chain(quotation.QuotationItem)
    .map((quoItem) =>
      lang === "en" ? quoItem.assumption_en : quoItem.assumption,
    )
    .filter((i) => i.length > 0)
    .map((i) => i.split("\n"))
    .reduce((acc, i) => [...acc, ...i], [] as string[])
    .uniq()
    .value();

  setCellValue(worksheet, "A1", "#", tableHeaderStyle);
  setCellValue(worksheet, "B1", "Assumption", tableHeaderStyle);

  let rowIndex = 2;
  _.each(assumptionRowList, (row) => {
    setCellValue(worksheet, `A${rowIndex}`, rowIndex - 1, {
      ...tableCellStyle,
      alignment: { horizontal: "center", vertical: "center" },
    });
    setCellValue(worksheet, `B${rowIndex}`, row, tableCellStyle);
    rowIndex++;
  });

  worksheet["!ref"] = `A1:B${rowIndex}`;
  worksheet["!cols"] = [{ wpx: 55 }, { wpx: 500 }];

  return worksheet;
};
