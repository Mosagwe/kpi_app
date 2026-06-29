import { AppError } from "./errors.js";
import { normalizeImportedRows } from "../domain/kpi.js";

export function createWorkbookService({ workbookGateway }) {
  return {
    async importKpis(file) {
      if (!file) throw new AppError("Choose a workbook to import.", 400);

      try {
        const worksheets = await workbookGateway.readWorksheets(file);
        const candidates = worksheets.map((sheet) => ({
          sheetName: sheet.sheetName,
          kpis: normalizeImportedRows(sheet.rows)
        }));
        const best = candidates.sort((a, b) => b.kpis.length - a.kpis.length)[0];

        if (!best?.kpis.length) {
          throw new AppError("No KPI rows were found. Include a column named KPI, Objective, Goal or Title.", 422);
        }
        return best;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          "This workbook could not be read. If it is password-protected or organization-encrypted, open it in Excel and save an unencrypted .xlsx copy first.",
          422
        );
      }
    },
    async exportAppraisal({ profile = {}, kpis = [] }) {
      if (!Array.isArray(kpis) || !kpis.length) {
        throw new AppError("There are no KPIs to export.", 400);
      }
      return workbookGateway.buildAppraisalWorkbook({ profile, kpis });
    },
    async exportMaster({ year = "master", kpis = [] }) {
      if (!Array.isArray(kpis) || !kpis.length) {
        throw new AppError("There are no master KPIs to export.", 400);
      }
      return workbookGateway.buildMasterWorkbook({ year, kpis });
    }
  };
}
