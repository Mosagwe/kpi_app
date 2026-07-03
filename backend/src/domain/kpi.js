export const DEFAULT_KPIS = [
  {
    id: "kpi-1",
    category: "Service Delivery",
    title: "Deliver reliable data and reporting services",
    description: "Provide accurate, timely and dependable data products to internal stakeholders.",
    measure: "Agreed reports and data requests delivered within SLA",
    target: "100%",
    weight: 25,
    selfAppraisal: 0,
    achievement: "",
    evidence: "",
    status: "not-started"
  },
  {
    id: "kpi-2",
    category: "Projects",
    title: "Deliver strategic data initiatives",
    description: "Complete assigned initiatives to agreed scope, quality and schedule.",
    measure: "Milestones completed on time",
    target: "100%",
    weight: 25,
    selfAppraisal: 0,
    achievement: "",
    evidence: "",
    status: "not-started"
  }
];


export function buildRefinementPrompt(kpi, options = {}) {
  const tone = options.tone || "confident";
  const instruction = options.instruction?.trim() || "Improve clarity and impact.";

  return `You are an expert performance appraisal writing coach.

Rewrite the employee's achievement for the KPI below.

Rules:
- Preserve every factual claim. Never invent metrics, dates, outcomes or responsibilities.
- Use concise, first-person professional language.
- Lead with the action, then quantify the result where evidence exists.
- Connect the work to the KPI target and business impact.
- Keep the final achievement between 50 and 120 words.
- Return only the refined achievement paragraph.

KPI: ${kpi.title}
Category: ${kpi.category || "Not specified"}
Description: ${kpi.description || "Not specified"}
Measure: ${kpi.measure || "Not specified"}
Target: ${kpi.target || "Not specified"}
Employee draft: ${kpi.achievement || "No draft supplied"}
Supporting evidence: ${kpi.evidence || "No evidence supplied"}
Preferred tone: ${tone}
Additional instruction: ${instruction}`;
}

export function normalizeImportedRows(rows) {
  if (!Array.isArray(rows)) return [];

  const aliases = {
    category: ["category", "perspective", "pillar", "area"],
    title: ["kpi", "kpi / objective", "objective", "goal", "key performance indicator", "title"],
    description: ["description", "details", "objective description"],
    measure: ["measure", "tactical", "tactical (measure)", "measurement", "success measure", "indicator"],
    target: ["target", "expected result"],
    weight: ["weight", "total weight", "weighting", "weight %", "weighting %"],
    selfAppraisal: ["self-appraisal (%)", "self appraisal (%)", "self-appraisal %", "self appraisal %", "self-appraisal", "self appraisal", "self score"],
    achievement: ["achievement", "achievements", "actual", "employee comments", "performance"],
    evidence: ["evidence", "supporting evidence", "proof", "reference"],
    status: ["status", "progress"]
  };

  const findValue = (row, names) => {
    const key = Object.keys(row).find((candidate) =>
      names.includes(String(candidate).trim().toLowerCase())
    );
    return key ? row[key] : "";
  };

  return rows
    .map((row, index) => {
      const title = normalizeMultiline(findValue(row, aliases.title));
      if (!title) return null;
      const rawWeight = findValue(row, aliases.weight);
      const parsedWeight = Number(String(rawWeight).replace("%", ""));
      const rawSelfAppraisal = findValue(row, aliases.selfAppraisal);
      const parsedSelfAppraisal = Number(String(rawSelfAppraisal).replace("%", ""));

      return {
        id: `imported-${Date.now()}-${index}`,
        category: normalizeSingleLine(findValue(row, aliases.category)) || "General",
        title,
        description: normalizeMultiline(findValue(row, aliases.description)),
        measure: normalizeMultiline(findValue(row, aliases.measure)),
        target: "100%",
        weight: Number.isFinite(parsedWeight) ? parsedWeight : 0,
        selfAppraisal: Number.isFinite(parsedSelfAppraisal) ? clampPercentage(parsedSelfAppraisal) : 0,
        achievement: normalizeMultiline(findValue(row, aliases.achievement)),
        evidence: normalizeMultiline(findValue(row, aliases.evidence)),
        status: normalizeStatus(findValue(row, aliases.status))
      };
    })
    .filter(Boolean);
}

export function isValidWorkspaceState(state) {
  return Boolean(state)
    && typeof state === "object"
    && Array.isArray(state.quarters)
    && (Boolean(state.mastersByYear) || Array.isArray(state.masterKpis));
}

export function displayStatus(status) {
  if (status === "complete") return "Complete";
  if (status === "in-progress") return "In progress";
  return "Not started";
}

function clampPercentage(value) {
  return Math.min(200, Math.max(0, value));
}

export function normalizeSingleLine(value) {
  return normalizeExcelText(value)
    .replace(/\t+/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMultiline(value) {
  return normalizeExcelText(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t+/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ ]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeExcelText(value) {
  let text = String(value || "")
    .replace(/\u00a0|\u202f/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\u2028|\u2029/g, "\n");

  text = text.trim();
  const formulaQuoted = text.match(/^=\s*"([\s\S]*)"\s*$/);
  const wrappedQuoted = text.match(/^"\s*([\s\S]*?)\s*"\s*$/);
  if (formulaQuoted) text = formulaQuoted[1];
  else if (wrappedQuoted) text = wrappedQuoted[1];
  text = text.replace(/""/g, '"');
  return text;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["complete", "completed", "done"].includes(status)) return "complete";
  if (["in-progress", "in progress", "ongoing"].includes(status)) return "in-progress";
  return "not-started";
}
