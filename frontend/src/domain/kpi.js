import { DEFAULT_KPIS } from "../data/defaultKpis.js";

export const STORAGE_KEY = "kpi-appraisal-assistant-v2";
export const LEGACY_STORAGE_KEY = "kpi-appraisal-assistant-v1";

export function createInitialWorkspace() {
  const masterKpis = DEFAULT_KPIS.map(cleanKpi);
  return {
    profile: { employee: "", role: "", department: "", manager: "" },
    mastersByYear: {
      2026: { kpis: masterKpis, source: "Built-in starter template" }
    },
    archivedMastersByYear: {},
    selectedMasterYear: 2026,
    activeQuarterId: null,
    archivedQuarters: [],
    quarters: [{
      id: "2026-q1",
      year: 2026,
      quarter: 1,
      createdAt: new Date().toISOString(),
      kpis: deriveQuarterKpis(masterKpis)
    }]
  };
}

export function loadCachedWorkspace() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if ((stored?.mastersByYear || stored?.masterKpis) && Array.isArray(stored.quarters)) {
      return normalizeWorkspace(stored);
    }

    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy?.kpis?.length) {
      const masterKpis = legacy.kpis.map(cleanKpi);
      return normalizeWorkspace({
        profile: legacy.profile,
        mastersByYear: {
          2026: { kpis: masterKpis, source: "Migrated from your existing scorecard" }
        },
        selectedMasterYear: 2026,
        activeQuarterId: null,
        quarters: [{
          id: "2026-q1",
          year: 2026,
          quarter: 1,
          createdAt: new Date().toISOString(),
          kpis: legacy.kpis.map(cleanKpi)
        }]
      });
    }
  } catch {
    return createInitialWorkspace();
  }
  return createInitialWorkspace();
}

export function normalizeWorkspace(value = {}) {
  const fallbackYear = Number(value.selectedMasterYear)
    || Number(value.quarters?.[0]?.year)
    || new Date().getFullYear();
  const mastersByYear = value.mastersByYear || {
    [fallbackYear]: {
      kpis: value.masterKpis || [],
      source: value.masterSource || "Migrated master template"
    }
  };
  const archivedMastersByYear = value.archivedMastersByYear || {};

  return {
    profile: {
      employee: cleanSingleLine(value.profile?.employee),
      role: cleanSingleLine(value.profile?.role),
      department: cleanSingleLine(value.profile?.department),
      manager: cleanSingleLine(value.profile?.manager)
    },
    mastersByYear: Object.fromEntries(
      Object.entries(mastersByYear).map(([year, master]) => [
        String(year),
        {
          kpis: (master?.kpis || []).map(cleanKpi),
          source: cleanSingleLine(master?.source) || "Saved master template"
        }
      ])
    ),
    archivedMastersByYear: Object.fromEntries(
      Object.entries(archivedMastersByYear).map(([year, master]) => [
        String(year),
        {
          kpis: (master?.kpis || []).map(cleanKpi),
          source: cleanSingleLine(master?.source) || "Archived master template",
          archivedAt: master?.archivedAt || new Date().toISOString()
        }
      ])
    ),
    selectedMasterYear: mastersByYear[String(fallbackYear)]
      ? fallbackYear
      : Number(Object.keys(mastersByYear).sort((a, b) => Number(b) - Number(a))[0]) || fallbackYear,
    activeQuarterId: value.activeQuarterId || null,
    archivedQuarters: (value.archivedQuarters || []).map((quarter) => ({
      id: quarter.id || `${quarter.year}-q${quarter.quarter}`,
      year: Number(quarter.year),
      quarter: Number(quarter.quarter),
      createdAt: quarter.createdAt || new Date().toISOString(),
      archivedAt: quarter.archivedAt || new Date().toISOString(),
      kpis: (quarter.kpis || []).map(cleanKpi)
    })),
    quarters: (value.quarters || []).map((quarter) => ({
      id: quarter.id || `${quarter.year}-q${quarter.quarter}`,
      year: Number(quarter.year),
      quarter: Number(quarter.quarter),
      createdAt: quarter.createdAt || new Date().toISOString(),
      kpis: (quarter.kpis || []).map(cleanKpi)
    }))
  };
}

export function cleanKpi(kpi = {}) {
  return {
    id: kpi.id || crypto.randomUUID(),
    category: cleanSingleLine(kpi.category) || "General",
    title: cleanMultiline(kpi.title),
    description: cleanMultiline(kpi.description),
    measure: cleanMultiline(kpi.measure),
    target: "100%",
    weight: Number(kpi.weight) || 0,
    selfAppraisal: clampPercentage(Number(kpi.selfAppraisal) || 0),
    achievement: cleanMultiline(kpi.achievement),
    evidence: cleanMultiline(kpi.evidence),
    status: ["not-started", "in-progress", "complete"].includes(kpi.status)
      ? kpi.status
      : "not-started"
  };
}

export function deriveQuarterKpis(masterKpis) {
  return masterKpis.map((kpi) => ({
    ...cleanKpi(kpi),
    id: crypto.randomUUID(),
    achievement: "",
    evidence: "",
    selfAppraisal: 0,
    status: "not-started"
  }));
}

export function cleanSingleLine(value) {
  return cleanExcelText(value)
    .replace(/\t+/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanMultiline(value) {
  return cleanExcelText(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t+/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ ]{2,}/g, " ").trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanExcelText(value) {
  let text = String(value || "")
    .replace(/\u00a0|\u202f/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\u2028|\u2029/g, "\n")
    .trim();
  const formulaQuoted = text.match(/^=\s*"([\s\S]*)"\s*$/);
  const wrappedQuoted = text.match(/^"\s*([\s\S]*?)\s*"\s*$/);
  if (formulaQuoted) text = formulaQuoted[1];
  else if (wrappedQuoted) text = wrappedQuoted[1];
  return text.replace(/""/g, '"');
}

export function clampPercentage(value) {
  return Math.min(200, Math.max(0, value));
}

export function quarterLabel(quarter) {
  return `${quarter.year} Q${quarter.quarter}`;
}

export function compareQuartersDescending(a, b) {
  return (b.year * 10 + b.quarter) - (a.year * 10 + a.quarter);
}

export function weightedKpiScore(kpi) {
  return ((Number(kpi.weight) || 0) * (Number(kpi.selfAppraisal) || 0)) / 100;
}

export function formatScore(value) {
  return Number(value.toFixed(2)).toString();
}

export function summarizeKpis(kpis = []) {
  const complete = kpis.filter((kpi) => kpi.status === "complete").length;
  const inProgress = kpis.filter((kpi) => kpi.status === "in-progress").length;
  const drafted = kpis.filter((kpi) => kpi.achievement.trim()).length;
  return {
    complete,
    drafted,
    progress: kpis.length ? Math.round(((complete + inProgress * 0.5) / kpis.length) * 100) : 0,
    weight: kpis.reduce((sum, kpi) => sum + (Number(kpi.weight) || 0), 0),
    totalScore: kpis.reduce((sum, kpi) => sum + weightedKpiScore(kpi), 0)
  };
}
