import { DEFAULT_KPIS } from "/shared-data.js";
import { MasterKpiRow, QuarterCard } from "/components.js";
import { actions, createAppStore } from "/store.js";

const STORAGE_KEY = "kpi-appraisal-assistant-v2";
const LEGACY_STORAGE_KEY = "kpi-appraisal-assistant-v1";
let state = loadState();
const store = createAppStore(state);
let activeKpiId = null;
let refinedText = "";
let editingKpiId = null;
let editingMasterKpiId = null;
let aiConfigured = false;
let mongoSaveTimer;
let mongoSaveChain = Promise.resolve();

const elements = {
  home: document.querySelector("#home-view"),
  master: document.querySelector("#master-view"),
  workspace: document.querySelector("#workspace-view"),
  quarterList: document.querySelector("#quarter-list"),
  quarterTemplate: document.querySelector("#quarter-template"),
  list: document.querySelector("#kpi-list"),
  template: document.querySelector("#kpi-template"),
  search: document.querySelector("#search"),
  fileInput: document.querySelector("#file-input"),
  dialog: document.querySelector("#ai-dialog"),
  original: document.querySelector("#ai-original"),
  result: document.querySelector("#ai-result"),
  title: document.querySelector("#ai-kpi-title"),
  generate: document.querySelector("#generate-refinement"),
  accept: document.querySelector("#accept-refinement")
};

init();

async function init() {
  bindGlobalEvents();
  hydrateProfile();
  showHome();
  await synchronizeWithMongoDB();
  hydrateProfile();
  showHome();
  try {
    const config = await fetch("/api/config").then((response) => response.json());
    aiConfigured = config.aiConfigured;
    const badge = document.querySelector("#ai-state");
    badge.className = `ai-state ${config.aiConfigured && !config.proxyError ? "ready" : "offline"}`;
    badge.innerHTML = config.proxyError
      ? '<span class="spark">*</span> Proxy setup needed'
      : config.aiConfigured
      ? `<span class="spark">*</span> AI ready${config.proxyConfigured ? " via proxy" : ""}`
      : '<span class="spark">*</span> AI setup needed';
  } catch {
    aiConfigured = false;
    document.querySelector("#ai-state").textContent = "AI unavailable";
  }
}

async function synchronizeWithMongoDB() {
  try {
    const response = await fetch("/api/state");
    if (response.status === 404) {
      await persistStateToMongoDB(structuredClone(state));
      setSaveStatus("Migrated to MongoDB");
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    state = normalizeState(data.state);
    store.dispatch(actions.replaceWorkspace(state));
    cacheState();
    setSaveStatus("Loaded from MongoDB");
  } catch (error) {
    setSaveStatus("MongoDB unavailable - using local cache");
    toast(error.message || "MongoDB is unavailable. Using the local cache.", true);
  }
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if ((stored?.mastersByYear || stored?.masterKpis) && Array.isArray(stored.quarters)) return normalizeState(stored);

    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy?.kpis?.length) {
      const masterKpis = legacy.kpis.map(cleanKpi);
      return normalizeState({
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
    // Start from a clean local draft if stored data is malformed.
  }

  const masterKpis = DEFAULT_KPIS.map(cleanKpi);
  return {
    profile: { employee: "", role: "", department: "", manager: "" },
    mastersByYear: {
      2026: { kpis: masterKpis, source: "Built-in starter template" }
    },
    selectedMasterYear: 2026,
    activeQuarterId: null,
    quarters: [{
      id: "2026-q1",
      year: 2026,
      quarter: 1,
      createdAt: new Date().toISOString(),
      kpis: deriveQuarterKpis(masterKpis)
    }]
  };
}

function normalizeState(value) {
  const fallbackYear = Number(value.selectedMasterYear)
    || Number(value.quarters?.[0]?.year)
    || new Date().getFullYear();
  const mastersByYear = value.mastersByYear || {
    [fallbackYear]: {
      kpis: value.masterKpis || [],
      source: value.masterSource || "Migrated master template"
    }
  };
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
    selectedMasterYear: fallbackYear,
    activeQuarterId: value.activeQuarterId || null,
    quarters: (value.quarters || []).map((item) => ({
      id: item.id || `${item.year}-q${item.quarter}`,
      year: Number(item.year),
      quarter: Number(item.quarter),
      createdAt: item.createdAt || new Date().toISOString(),
      kpis: (item.kpis || []).map(cleanKpi)
    }))
  };
}

function selectedMaster() {
  const year = String(state.selectedMasterYear);
  if (!state.mastersByYear[year]) {
    state.mastersByYear[year] = { kpis: [], source: "Created manually" };
  }
  return state.mastersByYear[year];
}

function cleanKpi(kpi) {
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

function cleanSingleLine(value) {
  return cleanExcelText(value)
    .replace(/\t+/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMultiline(value) {
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

function cleanExcelText(value) {
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

function deriveQuarterKpis(masterKpis) {
  return masterKpis.map((kpi) => ({
    ...cleanKpi(kpi),
    id: crypto.randomUUID(),
    achievement: "",
    evidence: "",
    selfAppraisal: 0,
    status: "not-started"
  }));
}

function clampPercentage(value) {
  return Math.min(200, Math.max(0, value));
}

function bindGlobalEvents() {
  document.querySelectorAll("[data-profile]").forEach((input) => {
    input.addEventListener("input", () => {
      if (input.dataset.profile !== "period") {
        state.profile[input.dataset.profile] = input.value;
        updateAvatar();
        save();
      }
    });
  });
  document.querySelectorAll('[data-action="import"]').forEach((button) =>
    button.addEventListener("click", () => elements.fileInput.click())
  );
  document.querySelectorAll('[data-action="export"]').forEach((button) =>
    button.addEventListener("click", exportWorkbook)
  );
  document.querySelector('[data-view="home"]').addEventListener("click", showHome);
  document.querySelectorAll('[data-view="master"]').forEach((button) =>
    button.addEventListener("click", showMaster)
  );
  document.querySelector("#back-home").addEventListener("click", showHome);
  document.querySelector("#create-master-kpi").addEventListener("click", () => openMasterEditor());
  document.querySelector("#master-year-select").addEventListener("change", (event) => {
    state.selectedMasterYear = Number(event.target.value);
    renderMasterKpis();
    save();
  });
  document.querySelector("#add-master-year").addEventListener("click", addMasterYear);
  document.querySelector("#new-quarter").addEventListener("click", openQuarterDialog);
  document.querySelector("#ai-state").addEventListener("click", () => {
    if (!aiConfigured) openAiSetup();
  });
  document.querySelector("#quarter-form").addEventListener("submit", createQuarter);
  elements.fileInput.addEventListener("change", importWorkbook);
  elements.search.addEventListener("input", renderWorkspace);
  document.querySelector("#add-kpi").addEventListener("click", addKpi);
  elements.generate.addEventListener("click", generateRefinement);
  elements.accept.addEventListener("click", acceptRefinement);
  document.querySelector("#edit-form").addEventListener("submit", saveKpiEdits);
  document.querySelector("#delete-kpi").addEventListener("click", deleteEditingKpi);
  document.querySelector("#master-edit-form").addEventListener("submit", saveMasterKpi);
  document.querySelector("#delete-master-kpi").addEventListener("click", deleteMasterKpi);
  bindPasteCleanup("#edit-category", cleanSingleLine);
  bindPasteCleanup("#edit-title", cleanMultiline);
  bindPasteCleanup("#edit-measure", cleanMultiline);
  bindPasteCleanup("#edit-description", cleanMultiline);
  bindPasteCleanup("#master-category", cleanSingleLine);
  bindPasteCleanup("#master-title-input", cleanMultiline);
  bindPasteCleanup("#master-measure", cleanMultiline);
  bindPasteCleanup("#master-description", cleanMultiline);
}

function bindPasteCleanup(selector, cleaner) {
  const input = document.querySelector(selector);
  input.addEventListener("paste", (event) => {
    const pasted = event.clipboardData?.getData("text");
    if (pasted == null) return;
    event.preventDefault();
    input.setRangeText(cleaner(pasted), input.selectionStart, input.selectionEnd, "end");
  });
}

function activeQuarter() {
  return state.quarters.find((item) => item.id === state.activeQuarterId) || null;
}

function showHome() {
  store.dispatch(actions.setView("home"));
  state.activeQuarterId = null;
  elements.home.hidden = false;
  elements.master.hidden = true;
  elements.workspace.hidden = true;
  document.querySelector("#back-home").hidden = true;
  document.querySelectorAll(".workspace-only").forEach((element) => { element.hidden = true; });
  document.querySelector("#page-eyebrow").textContent = "PERFORMANCE WORKSPACE";
  document.querySelector("#page-title").textContent = "Quarterly KPI appraisals";
  const availableYears = Object.keys(state.mastersByYear).sort((a, b) => Number(b) - Number(a));
  document.querySelector("#master-summary").textContent = availableYears.length
    ? `Annual master templates available for ${availableYears.join(", ")}.`
    : "No annual master template has been created.";
  renderQuarterList();
  save();
}

function showMaster() {
  store.dispatch(actions.setView("master"));
  state.activeQuarterId = null;
  elements.home.hidden = true;
  elements.master.hidden = false;
  elements.workspace.hidden = true;
  document.querySelector("#back-home").hidden = true;
  document.querySelectorAll(".workspace-only").forEach((element) => { element.hidden = true; });
  document.querySelector("#page-eyebrow").textContent = "MASTER TEMPLATE";
  document.querySelector("#page-title").textContent = "Create or upload master KPIs";
  renderMasterYearOptions();
  renderMasterKpis();
  save();
}

function renderMasterYearOptions() {
  const select = document.querySelector("#master-year-select");
  const years = Object.keys(state.mastersByYear).map(Number).sort((a, b) => b - a);
  select.innerHTML = "";
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    option.selected = year === Number(state.selectedMasterYear);
    select.append(option);
  });
}

function addMasterYear() {
  const year = Number(window.prompt("Master KPI year", new Date().getFullYear()));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    toast("Enter a valid year between 2020 and 2100.", true);
    return;
  }
  if (!state.mastersByYear[String(year)]) {
    state.mastersByYear[String(year)] = { kpis: [], source: "Created manually" };
  }
  state.selectedMasterYear = year;
  renderMasterYearOptions();
  renderMasterKpis();
  save();
}

function openQuarter(id) {
  store.dispatch(actions.setView("workspace"));
  state.activeQuarterId = id;
  const quarter = activeQuarter();
  if (!quarter) return showHome();
  elements.home.hidden = true;
  elements.master.hidden = true;
  elements.workspace.hidden = false;
  document.querySelector("#back-home").hidden = false;
  document.querySelectorAll(".workspace-only").forEach((element) => { element.hidden = false; });
  document.querySelector("#page-eyebrow").textContent = "QUARTERLY APPRAISAL";
  document.querySelector("#page-title").textContent = quarterLabel(quarter);
  hydrateProfile();
  renderWorkspace();
  save();
}

function renderMasterKpis() {
  const master = selectedMaster();
  const list = document.querySelector("#master-kpi-list");
  list.innerHTML = "";
  document.querySelectorAll(".selected-master-year-label").forEach((element) => {
    element.textContent = state.selectedMasterYear;
  });
  document.querySelector("#master-count").textContent =
    `${master.kpis.length} KPI${master.kpis.length === 1 ? "" : "s"}`;
  if (!master.kpis.length) {
    list.innerHTML = '<div class="empty-state"><h3>No master KPIs yet</h3><p>Add the first KPI manually or upload an unprotected workbook.</p></div>';
    return;
  }
  master.kpis.forEach((kpi, index) => {
    list.append(MasterKpiRow({
      kpi,
      index,
      onEdit: () => openMasterEditor(kpi)
    }));
  });
}

function openMasterEditor(kpi = null) {
  editingMasterKpiId = kpi?.id || null;
  document.querySelector("#master-edit-heading").textContent = kpi ? "Edit master KPI" : "Add master KPI";
  document.querySelector("#master-category").value = kpi?.category || "";
  document.querySelector("#master-title-input").value = kpi?.title || "";
  document.querySelector("#master-measure").value = kpi?.measure || "";
  document.querySelector("#master-weight").value = kpi?.weight ?? 0;
  document.querySelector("#master-description").value = kpi?.description || "";
  document.querySelector("#delete-master-kpi").hidden = !kpi;
  document.querySelector("#master-edit-dialog").showModal();
}

function saveMasterKpi(event) {
  event.preventDefault();
  const title = cleanMultiline(document.querySelector("#master-title-input").value);
  if (!title) {
    toast("The KPI / Objective is required.", true);
    return;
  }
  const values = cleanKpi({
    id: editingMasterKpiId || crypto.randomUUID(),
    category: document.querySelector("#master-category").value,
    title,
    measure: document.querySelector("#master-measure").value,
    weight: document.querySelector("#master-weight").value,
    description: document.querySelector("#master-description").value
  });
  const master = selectedMaster();
  const existingIndex = master.kpis.findIndex((item) => item.id === editingMasterKpiId);
  if (existingIndex >= 0) master.kpis[existingIndex] = values;
  else master.kpis.push(values);
  master.source = "Created manually";
  save();
  renderMasterKpis();
  document.querySelector("#master-edit-dialog").close();
  toast(existingIndex >= 0 ? "Master KPI updated." : "Master KPI added.");
}

function deleteMasterKpi() {
  const master = selectedMaster();
  const kpi = master.kpis.find((item) => item.id === editingMasterKpiId);
  if (!kpi || !window.confirm(`Remove "${kpi.title}" from the master template?`)) return;
  master.kpis = master.kpis.filter((item) => item.id !== editingMasterKpiId);
  editingMasterKpiId = null;
  save();
  renderMasterKpis();
  document.querySelector("#master-edit-dialog").close();
  toast("Master KPI removed. Existing quarters were not changed.");
}

function renderQuarterList() {
  elements.quarterList.innerHTML = "";
  const sorted = [...state.quarters].sort(compareQuartersDescending);
  if (!sorted.length) {
    elements.quarterList.innerHTML = '<div class="empty-state"><h3>No quarterly KPIs yet</h3><p>Create a quarter from your master KPI template.</p></div>';
    return;
  }
  sorted.forEach((quarter) => {
    const drafted = quarter.kpis.filter((kpi) => kpi.achievement).length;
    const complete = quarter.kpis.filter((kpi) => kpi.status === "complete").length;
    const progress = quarter.kpis.length ? Math.round((complete / quarter.kpis.length) * 100) : 0;
    elements.quarterList.append(QuarterCard({
      quarter,
      label: quarterLabel(quarter),
      drafted,
      progress,
      onOpen: () => openQuarter(quarter.id),
      onDelete: () => deleteQuarter(quarter)
    }));
  });
}

function deleteQuarter(quarter) {
  const label = quarterLabel(quarter);
  const confirmed = window.confirm(
    `Delete ${label}?\n\nThis permanently removes all KPIs, achievements, evidence, statuses and scores for this quarter.`
  );
  if (!confirmed) return;
  state.quarters = state.quarters.filter((item) => item.id !== quarter.id);
  if (state.activeQuarterId === quarter.id) state.activeQuarterId = null;
  save();
  renderQuarterList();
  toast(`${label} was deleted.`);
}

function compareQuartersDescending(a, b) {
  return (b.year * 10 + b.quarter) - (a.year * 10 + a.quarter);
}

function quarterLabel(quarter) {
  return `${quarter.year} Q${quarter.quarter}`;
}

function openQuarterDialog() {
  const now = new Date();
  document.querySelector("#quarter-year").value = now.getFullYear();
  document.querySelector("#quarter-number").value = String(Math.floor(now.getMonth() / 3) + 1);
  document.querySelector("#quarter-dialog").showModal();
}

function createQuarter(event) {
  event.preventDefault();
  const year = Number(document.querySelector("#quarter-year").value);
  const quarterNumber = Number(document.querySelector("#quarter-number").value);
  const id = `${year}-q${quarterNumber}`;
  if (state.quarters.some((item) => item.id === id)) {
    toast(`${year} Q${quarterNumber} already exists.`, true);
    return;
  }
  const annualMaster = state.mastersByYear[String(year)];
  if (!annualMaster?.kpis?.length) {
    toast(`Create or upload the ${year} master KPIs before creating this quarter.`, true);
    return;
  }
  state.quarters.push({
    id,
    year,
    quarter: quarterNumber,
    createdAt: new Date().toISOString(),
    kpis: deriveQuarterKpis(annualMaster.kpis)
  });
  save();
  document.querySelector("#quarter-dialog").close();
  openQuarter(id);
  toast(`${year} Q${quarterNumber} created from the ${year} master KPIs.`);
}

function hydrateProfile() {
  Object.entries(state.profile).forEach(([key, value]) => {
    const input = document.querySelector(`[data-profile="${key}"]`);
    if (input) input.value = value;
  });
  const quarter = activeQuarter();
  document.querySelector("#period").value = quarter ? quarterLabel(quarter) : "";
  updateAvatar();
}

function renderWorkspace() {
  const quarter = activeQuarter();
  if (!quarter) return;
  const query = elements.search.value.trim().toLowerCase();
  elements.list.innerHTML = "";
  quarter.kpis
    .filter((kpi) => [kpi.title, kpi.category, kpi.description, kpi.measure].join(" ").toLowerCase().includes(query))
    .forEach((kpi) => elements.list.append(createKpiCard(kpi, quarter.kpis)));
  updateSummary();
}

function createKpiCard(kpi, kpis) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  card.dataset.id = kpi.id;
  card.querySelector(".kpi-number").textContent = kpis.indexOf(kpi) + 1;
  card.querySelector(".category").textContent = kpi.category || "General";
  card.querySelector(".weight-pill").textContent = `${Number(kpi.weight) || 0}% weight`;
  card.querySelector(".title").textContent = kpi.title;
  card.querySelector(".title").title = kpi.title;
  card.querySelector(".description").textContent = kpi.description || "No description added.";
  card.querySelector(".measure").textContent = kpi.measure || "Not specified";
  card.querySelector(".target").textContent = "100%";
  const selfAppraisal = card.querySelector(".self-appraisal");
  const weightedScore = card.querySelector(".weighted-score");
  selfAppraisal.value = kpi.selfAppraisal || "";
  updateWeightedScore(kpi, weightedScore);
  selfAppraisal.addEventListener("input", () => {
    kpi.selfAppraisal = clampPercentage(Number(selfAppraisal.value) || 0);
    if (Number(selfAppraisal.value) > 200) selfAppraisal.value = 200;
    if (Number(selfAppraisal.value) < 0) selfAppraisal.value = 0;
    updateWeightedScore(kpi, weightedScore);
    saveAndRenderSummary();
  });

  const status = card.querySelector(".status-select");
  status.value = kpi.status;
  status.dataset.status = kpi.status;
  status.addEventListener("change", () => {
    kpi.status = status.value;
    status.dataset.status = status.value;
    saveAndRenderSummary();
  });

  const achievement = card.querySelector(".achievement");
  const evidence = card.querySelector(".evidence");
  achievement.value = kpi.achievement;
  evidence.value = kpi.evidence;
  updateWordCount(card, achievement.value);
  achievement.addEventListener("input", () => {
    kpi.achievement = achievement.value;
    updateWordCount(card, achievement.value);
    card.querySelector(".draft-state").textContent = achievement.value.trim() ? "Draft saved" : "Draft";
    saveAndRenderSummary();
  });
  achievement.addEventListener("blur", () => {
    kpi.achievement = cleanMultiline(achievement.value);
    achievement.value = kpi.achievement;
    save();
  });
  evidence.addEventListener("input", () => {
    kpi.evidence = evidence.value;
    save();
  });
  evidence.addEventListener("blur", () => {
    kpi.evidence = cleanMultiline(evidence.value);
    evidence.value = kpi.evidence;
    save();
  });
  card.querySelector(".refine-button").addEventListener("click", () => openRefinement(kpi));
  card.querySelector(".more-button").addEventListener("click", () => openKpiEditor(kpi));
  return card;
}

function updateWordCount(card, value) {
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  card.querySelector(".character-count").textContent = `${words} word${words === 1 ? "" : "s"}`;
}

function updateWeightedScore(kpi, element) {
  element.textContent = `${formatScore(weightedKpiScore(kpi))}%`;
}

function weightedKpiScore(kpi) {
  return ((Number(kpi.weight) || 0) * (Number(kpi.selfAppraisal) || 0)) / 100;
}

function formatScore(value) {
  return Number(value.toFixed(2)).toString();
}

function updateSummary() {
  const kpis = activeQuarter()?.kpis || [];
  const complete = kpis.filter((kpi) => kpi.status === "complete").length;
  const inProgress = kpis.filter((kpi) => kpi.status === "in-progress").length;
  const drafted = kpis.filter((kpi) => kpi.achievement.trim()).length;
  const progress = kpis.length ? Math.round(((complete + inProgress * 0.5) / kpis.length) * 100) : 0;
  const weight = kpis.reduce((sum, kpi) => sum + (Number(kpi.weight) || 0), 0);
  const totalScore = kpis.reduce((sum, kpi) => sum + weightedKpiScore(kpi), 0);
  document.querySelector("#overall-progress").textContent = `${progress}%`;
  document.querySelector("#progress-bar").style.width = `${progress}%`;
  document.querySelector("#total-weight").textContent = `${weight}%`;
  document.querySelector("#weight-note").textContent = weight === 100 ? "Balanced scorecard" : "Target total: 100%";
  document.querySelector("#draft-count").textContent = `${drafted} / ${kpis.length}`;
  document.querySelector("#total-score").textContent = `${formatScore(totalScore)}%`;
  document.querySelector("#complete-note").textContent = `${complete} KPI${complete === 1 ? "" : "s"} marked complete`;
}

function addKpi() {
  const quarter = activeQuarter();
  if (!quarter) return;
  const kpi = cleanKpi({
    id: crypto.randomUUID(),
    category: "General",
    title: "New KPI",
    measure: "",
    weight: 0
  });
  quarter.kpis.push(kpi);
  save();
  renderWorkspace();
  openKpiEditor(kpi);
}

function openKpiEditor(kpi) {
  editingKpiId = kpi.id;
  document.querySelector("#edit-title").value = kpi.title;
  document.querySelector("#edit-category").value = kpi.category;
  document.querySelector("#edit-weight").value = Number(kpi.weight) || 0;
  document.querySelector("#edit-description").value = kpi.description;
  document.querySelector("#edit-measure").value = kpi.measure;
  document.querySelector("#edit-target").value = "100%";
  document.querySelector("#edit-dialog").showModal();
}

function saveKpiEdits(event) {
  event.preventDefault();
  const quarter = activeQuarter();
  const kpi = quarter?.kpis.find((item) => item.id === editingKpiId);
  if (!kpi) return;
  const title = cleanMultiline(document.querySelector("#edit-title").value);
  if (!title) {
    toast("The KPI title is required.", true);
    return;
  }
  kpi.category = cleanSingleLine(document.querySelector("#edit-category").value) || "General";
  kpi.title = title;
  kpi.measure = cleanMultiline(document.querySelector("#edit-measure").value);
  kpi.weight = Number(document.querySelector("#edit-weight").value) || 0;
  kpi.description = cleanMultiline(document.querySelector("#edit-description").value);
  kpi.target = "100%";
  save();
  renderWorkspace();
  document.querySelector("#edit-dialog").close();
  toast("KPI details updated and pasted spacing cleaned.");
}

function deleteEditingKpi() {
  const quarter = activeQuarter();
  const kpi = quarter?.kpis.find((item) => item.id === editingKpiId);
  if (!kpi || !window.confirm(`Remove "${kpi.title}"?`)) return;
  quarter.kpis = quarter.kpis.filter((item) => item.id !== editingKpiId);
  editingKpiId = null;
  save();
  renderWorkspace();
  document.querySelector("#edit-dialog").close();
  toast("KPI removed.");
}

function openRefinement(kpi) {
  if (!aiConfigured) {
    openAiSetup();
    return;
  }
  if (!kpi.achievement.trim()) {
    toast("Add an achievement draft first. AI needs your facts to work with.", true);
    return;
  }
  activeKpiId = kpi.id;
  refinedText = "";
  elements.title.textContent = kpi.title;
  elements.original.textContent = kpi.achievement;
  elements.result.textContent = "Your refined version will appear here.";
  elements.result.classList.add("empty");
  elements.accept.disabled = true;
  setAiError("");
  elements.dialog.showModal();
}

function openAiSetup() {
  document.querySelector("#ai-setup-dialog").showModal();
}

async function generateRefinement() {
  const kpi = activeQuarter()?.kpis.find((item) => item.id === activeKpiId);
  if (!kpi) return;
  elements.generate.disabled = true;
  elements.generate.textContent = "Refining...";
  setAiError("");
  try {
    const response = await fetch("/api/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kpi,
        tone: document.querySelector("#ai-tone").value,
        instruction: document.querySelector("#ai-instruction").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    refinedText = cleanMultiline(data.refined);
    elements.result.textContent = refinedText;
    elements.result.classList.remove("empty");
    elements.accept.disabled = false;
  } catch (error) {
    setAiError(error.message || "Refinement failed.");
  } finally {
    elements.generate.disabled = false;
    elements.generate.innerHTML = "<span>*</span> Refine with AI";
  }
}

function setAiError(message) {
  const errorPanel = document.querySelector("#ai-error");
  errorPanel.textContent = message;
  errorPanel.hidden = !message;
}

function acceptRefinement() {
  const kpi = activeQuarter()?.kpis.find((item) => item.id === activeKpiId);
  if (!kpi || !refinedText) return;
  kpi.achievement = refinedText;
  save();
  renderWorkspace();
  elements.dialog.close();
  toast("Refined achievement added to your appraisal.");
}

async function importWorkbook() {
  const file = elements.fileInput.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("workbook", file);
  try {
    const response = await fetch("/api/import", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const master = selectedMaster();
    master.kpis = data.kpis.map(cleanKpi);
    master.source = file.name;
    save();
    showMaster();
    toast(`${data.kpis.length} KPIs loaded into the ${state.selectedMasterYear} master.`);
  } catch (error) {
    toast(error.message || "Workbook import failed.", true);
  } finally {
    elements.fileInput.value = "";
  }
}

async function exportWorkbook() {
  const quarter = activeQuarter();
  if (!quarter) {
    toast("Open a quarterly appraisal before exporting.", true);
    return;
  }
  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: { ...state.profile, period: quarterLabel(quarter) },
        kpis: quarter.kpis
      })
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || "kpi-appraisal.xlsx";
    link.click();
    URL.revokeObjectURL(url);
    toast(`${quarterLabel(quarter)} exported to Excel.`);
  } catch (error) {
    toast(error.message || "Export failed.", true);
  }
}

function updateAvatar() {
  const initials = (state.profile.employee || "KPI")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  document.querySelector("#avatar").textContent = initials;
}

function saveAndRenderSummary() {
  save();
  updateSummary();
}

function save() {
  store.dispatch(actions.replaceWorkspace(state));
  cacheState();
  scheduleMongoSave();
}

function cacheState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function scheduleMongoSave() {
  clearTimeout(mongoSaveTimer);
  setSaveStatus("Saving to MongoDB...");
  mongoSaveTimer = setTimeout(() => {
    const snapshot = structuredClone(state);
    mongoSaveChain = mongoSaveChain
      .catch(() => {})
      .then(() => persistStateToMongoDB(snapshot))
      .then(() => setSaveStatus("Saved to MongoDB"))
      .catch(() => setSaveStatus("MongoDB save failed - cached locally"));
  }, 600);
}

async function persistStateToMongoDB(snapshot) {
  const response = await fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function setSaveStatus(message) {
  store.dispatch(actions.setSaveStatus(message));
  const status = document.querySelector("#save-status");
  if (status) status.textContent = store.getState().ui.saveStatus;
}

function toast(message, error = false) {
  const element = document.createElement("div");
  element.className = `toast${error ? " error" : ""}`;
  element.textContent = message;
  document.querySelector("#toast-region").append(element);
  setTimeout(() => element.remove(), 4500);
}
