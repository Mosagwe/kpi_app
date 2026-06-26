import { createSlice } from "@reduxjs/toolkit";
import {
  cleanKpi,
  cleanMultiline,
  cleanSingleLine,
  deriveQuarterKpis,
  loadCachedWorkspace,
  normalizeWorkspace
} from "../domain/kpi.js";

const initialState = loadCachedWorkspace();

const workspaceSlice = createSlice({
  name: "workspace",
  initialState,
  reducers: {
    replaceWorkspace: (_state, action) => normalizeWorkspace(action.payload),
    setActiveQuarter: (state, action) => {
      state.activeQuarterId = action.payload;
    },
    updateProfileField: (state, action) => {
      const { field, value } = action.payload;
      if (field !== "period") state.profile[field] = value;
    },
    selectMasterYear: (state, action) => {
      state.selectedMasterYear = Number(action.payload);
    },
    addMasterYear: (state, action) => {
      const year = Number(action.payload);
      if (!state.mastersByYear[String(year)]) {
        state.mastersByYear[String(year)] = { kpis: [], source: "Created manually" };
      }
      delete state.archivedMastersByYear?.[String(year)];
      state.selectedMasterYear = year;
    },
    archiveMasterYear: (state, action) => {
      const year = String(action.payload);
      const master = state.mastersByYear[year];
      if (!master) return;
      state.archivedMastersByYear ||= {};
      state.archivedMastersByYear[year] = {
        ...master,
        kpis: master.kpis.map(cleanKpi),
        source: master.source || "Archived master template",
        archivedAt: new Date().toISOString()
      };
      delete state.mastersByYear[year];
      if (String(state.selectedMasterYear) === year) {
        const remainingYear = Object.keys(state.mastersByYear).sort((a, b) => Number(b) - Number(a))[0];
        state.selectedMasterYear = remainingYear ? Number(remainingYear) : new Date().getFullYear();
      }
    },
    activateMasterYear: (state, action) => {
      const year = String(action.payload);
      const archived = state.archivedMastersByYear?.[year];
      if (!archived) return;
      state.mastersByYear[year] = {
        kpis: archived.kpis.map(cleanKpi),
        source: archived.source || "Activated archived master template"
      };
      delete state.archivedMastersByYear[year];
      state.selectedMasterYear = Number(year);
    },
    upsertMasterKpi: (state, action) => {
      const master = ensureSelectedMaster(state);
      const kpi = cleanKpi(action.payload);
      const index = master.kpis.findIndex((item) => item.id === kpi.id);
      if (index >= 0) master.kpis[index] = kpi;
      else master.kpis.push(kpi);
      master.source = "Created manually";
    },
    deleteMasterKpi: (state, action) => {
      const master = ensureSelectedMaster(state);
      master.kpis = master.kpis.filter((item) => item.id !== action.payload);
    },
    replaceSelectedMasterKpis: (state, action) => {
      const master = ensureSelectedMaster(state);
      master.kpis = action.payload.kpis.map(cleanKpi);
      master.source = action.payload.source || "Imported workbook";
    },
    createQuarter: (state, action) => {
      const { year, quarter } = action.payload;
      const id = `${year}-q${quarter}`;
      const annualMaster = state.mastersByYear[String(year)];
      state.quarters.push({
        id,
        year,
        quarter,
        createdAt: new Date().toISOString(),
        kpis: deriveQuarterKpis(annualMaster.kpis)
      });
      state.activeQuarterId = id;
    },
    deleteQuarter: (state, action) => {
      state.quarters = state.quarters.filter((quarter) => quarter.id !== action.payload);
      if (state.activeQuarterId === action.payload) state.activeQuarterId = null;
    },
    archiveQuarter: (state, action) => {
      const quarter = state.quarters.find((item) => item.id === action.payload);
      if (!quarter) return;
      state.archivedQuarters ||= [];
      state.archivedQuarters.push({
        ...quarter,
        kpis: quarter.kpis.map(cleanKpi),
        archivedAt: new Date().toISOString()
      });
      state.quarters = state.quarters.filter((item) => item.id !== action.payload);
      if (state.activeQuarterId === action.payload) state.activeQuarterId = null;
    },
    activateQuarter: (state, action) => {
      const quarter = state.archivedQuarters?.find((item) => item.id === action.payload);
      if (!quarter) return;
      state.quarters.push({
        ...quarter,
        kpis: quarter.kpis.map(cleanKpi)
      });
      state.archivedQuarters = state.archivedQuarters.filter((item) => item.id !== action.payload);
      state.activeQuarterId = quarter.id;
    },
    addKpi: (state, action) => {
      const quarter = activeQuarter(state);
      if (!quarter) return;
      quarter.kpis.push(cleanKpi(action.payload));
    },
    updateKpi: (state, action) => {
      const quarter = activeQuarter(state);
      const index = quarter?.kpis.findIndex((kpi) => kpi.id === action.payload.id);
      if (index >= 0) quarter.kpis[index] = { ...quarter.kpis[index], ...cleanKpi(action.payload) };
    },
    patchKpi: (state, action) => {
      const quarter = activeQuarter(state);
      const kpi = quarter?.kpis.find((item) => item.id === action.payload.id);
      if (!kpi) return;
      Object.entries(action.payload.patch).forEach(([key, value]) => {
        kpi[key] = key === "category"
            ? cleanSingleLine(value) || "General"
            : value;
      });
    },
    deleteKpi: (state, action) => {
      const quarter = activeQuarter(state);
      if (quarter) quarter.kpis = quarter.kpis.filter((kpi) => kpi.id !== action.payload);
    }
  }
});

function ensureSelectedMaster(state) {
  const year = String(state.selectedMasterYear);
  if (!state.mastersByYear[year]) {
    state.mastersByYear[year] = { kpis: [], source: "Created manually" };
  }
  return state.mastersByYear[year];
}

function activeQuarter(state) {
  return state.quarters.find((quarter) => quarter.id === state.activeQuarterId) || null;
}

export const workspaceActions = workspaceSlice.actions;
export const workspaceReducer = workspaceSlice.reducer;
