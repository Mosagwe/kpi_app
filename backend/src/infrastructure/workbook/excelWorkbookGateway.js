import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { displayStatus } from "../../domain/kpi.js";

export function createExcelWorkbookGateway() {
  return {
    async readWorksheets(file) {
      const workbook = new ExcelJS.Workbook();
      if (file.originalname.toLowerCase().endsWith(".csv")) {
        await workbook.csv.read(Readable.from(file.buffer));
      } else {
        await workbook.xlsx.load(file.buffer);
      }
      return workbook.worksheets.map((sheet) => ({
        sheetName: sheet.name,
        rows: worksheetToObjects(sheet)
      }));
    },
    async buildAppraisalWorkbook({ profile, kpis }) {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "KPI Appraisal Assistant";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("KPI Appraisal", {
        views: [{ state: "frozen", ySplit: 9 }]
      });
      const summaryRows = [
        ["KPI APPRAISAL"],
        [],
        ["Employee", profile.employee || ""],
        ["Role", profile.role || ""],
        ["Department", profile.department || ""],
        ["Review period", profile.period || ""],
        ["Manager", profile.manager || ""],
        [],
        ["Category", "KPI / Objective", "Tactical (Measure)", "Total Weight", "Achievement", "Supporting Evidence", "Self Appraisal", "Total Score", "Status"],
        ...kpis.map((kpi) => [
          kpi.category,
          kpi.title,
          kpi.measure,
          Number(kpi.weight) || 0,
          kpi.achievement,
          kpi.evidence,
          Number(kpi.selfAppraisal) || 0,
          ((Number(kpi.weight) || 0) * (Number(kpi.selfAppraisal) || 0)) / 100,
          displayStatus(kpi.status)
        ])
      ];
      summaryRows.forEach((row) => sheet.addRow(row));
      sheet.columns = [
        { width: 22 }, { width: 38 }, { width: 34 }, { width: 14 }, { width: 65 },
        { width: 42 }, { width: 18 }, { width: 16 }, { width: 16 }
      ];
      sheet.mergeCells("A1:I1");
      sheet.getCell("A1").font = { name: "Arial", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F36" } };
      sheet.getCell("A1").alignment = { vertical: "middle" };
      sheet.getRow(1).height = 32;
      sheet.getRow(9).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24584C" } };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
      for (let row = 10; row <= 9 + kpis.length; row += 1) {
        sheet.getRow(row).alignment = { vertical: "top", wrapText: true };
        sheet.getCell(`H${row}`).value = {
          formula: `D${row}*G${row}/100`,
          result: ((Number(kpis[row - 10].weight) || 0) * (Number(kpis[row - 10].selfAppraisal) || 0)) / 100
        };
        sheet.getCell(`H${row}`).numFmt = '0.00"%"';
      }
      sheet.autoFilter = { from: "A9", to: `I${9 + kpis.length}` };

      const safeName = (profile.employee || "employee").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      return {
        buffer: await workbook.xlsx.writeBuffer(),
        filename: `${safeName || "employee"}-kpi-appraisal.xlsx`
      };
    },
    async buildMasterWorkbook({ year, kpis }) {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "KPI Appraisal Assistant";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Master KPIs", {
        views: [{ state: "frozen", ySplit: 1 }]
      });
      sheet.addRow(["Category", "KPI / Objective", "Tactical (Measure)", "Total Weight", "Description", "Target"]);
      kpis.forEach((kpi) => {
        sheet.addRow([
          kpi.category || "General",
          kpi.title || "",
          kpi.measure || "",
          Number(kpi.weight) || 0,
          kpi.description || "",
          kpi.target || "100%"
        ]);
      });
      sheet.columns = [
        { width: 22 },
        { width: 34 },
        { width: 38 },
        { width: 14 },
        { width: 44 },
        { width: 12 }
      ];
      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF198754" } };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
      for (let row = 2; row <= 1 + kpis.length; row += 1) {
        sheet.getRow(row).alignment = { vertical: "top", wrapText: true };
      }
      sheet.autoFilter = { from: "A1", to: `F${1 + kpis.length}` };

      const safeYear = String(year).replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "") || "master";
      return {
        buffer: await workbook.xlsx.writeBuffer(),
        filename: `${safeYear}-master-kpis.xlsx`
      };
    }
  };
}

function worksheetToObjects(sheet) {
  const populatedRows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    populatedRows.push(row.values.slice(1).map(cellText));
  });
  if (populatedRows.length < 2) return [];

  const headerIndex = populatedRows.findIndex((row) =>
    row.some((value) =>
      ["kpi", "kpi / objective", "objective", "goal", "title", "key performance indicator"].includes(value.toLowerCase())
    )
  );
  if (headerIndex === -1) return [];
  const headers = populatedRows[headerIndex];
  return populatedRows.slice(headerIndex + 1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, values[index] || ""]))
  );
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value) return String(value.text);
    if ("result" in value) return String(value.result ?? "");
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  }
  return String(value).trim();
}
