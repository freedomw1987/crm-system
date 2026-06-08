// 定義邊框樣式
export const borderStyle = {
  top: { style: "thin", color: { rgb: "000000" } },
  bottom: { style: "thin", color: { rgb: "000000" } },
  left: { style: "thin", color: { rgb: "000000" } },
  right: { style: "thin", color: { rgb: "000000" } },
};

// 第 1 行：標題（合併 A1:F1，字體大小 22）
export const titleStyle = {
  font: { sz: "22", bold: true, underline: true },
  fill: { fgColor: { rgb: "dae1f2" } },
  alignment: { vertical: "center", horizontal: "center" },
  border: borderStyle,
};

// 第 2 行：表頭
export const tableHeaderStyle = {
  font: { bold: true },
  alignment: { vertical: "center", horizontal: "center" },
  border: borderStyle,
};

// 第 3 行：表格
export const tableCellStyle = {
  border: borderStyle,
};

export const salesCostCellStyle = {
  ...tableCellStyle,
  fill: { fgColor: { rgb: "fff3cc" } },
};

// 第 4 行：標題
export const itemTitleStyle = {
  font: { bold: true },
  alignment: { vertical: "center", horizontal: "left" },
};
