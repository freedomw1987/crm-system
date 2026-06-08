import _ from "lodash";
import { WorkSheet } from "xlsx-js-style";
import { setCellValue } from "./table";
import { tableCellStyle, tableHeaderStyle } from "./table-style";

export const sowWorkSheet = (quotation: any, lang: "en" | "zh"): WorkSheet => {
  const worksheet: WorkSheet = {};

  setCellValue(worksheet, "A1", "#", tableHeaderStyle);
  setCellValue(worksheet, "B1", "Item", tableHeaderStyle);
  setCellValue(worksheet, "C1", "Description", tableHeaderStyle);

  const sowRowList = _.chain(quotation.QuotationItem)
    .filter((quoItem) => quoItem.sku !== "Barco-MA")
    .map((quoItem) =>
      lang === "en"
        ? {
            index: quoItem.index,
            product_name: quoItem.product_name_en,
            sow: quoItem.sow_en,
          }
        : {
            index: quoItem.index,
            product_name: quoItem.product_name,
            sow: quoItem.sow,
          },
    )
    .value();

  let rowIndex = 2;
  _.each(sowRowList, (row) => {
    setCellValue(worksheet, `A${rowIndex}`, row.index, {
      ...tableCellStyle,
      alignment: { horizontal: "center", vertical: "center" },
    });
    setCellValue(worksheet, `B${rowIndex}`, row.product_name, {
      ...tableCellStyle,
      alignment: { horizontal: "center", vertical: "center" },
    });
    setCellValue(worksheet, `C${rowIndex++}`, row.sow, {
      ...tableCellStyle,
      alignment: { wrapText: true, vertical: "top" },
    });
  });

  worksheet["!ref"] = `A1:C${rowIndex - 1}`;
  worksheet["!cols"] = [{ wpx: 55 }, { wpx: 200 }, { wpx: 400 }];

  return worksheet;
};

export const getSOWDetailTable = () => {};
