export const selectWorkspace = (state) => state.workspace;
export const selectProfile = (state) => state.workspace.profile;
export const selectActiveQuarter = (state) =>
  state.workspace.quarters.find((quarter) => quarter.id === state.workspace.activeQuarterId) || null;
export const selectSelectedMaster = (state) =>
  state.workspace.mastersByYear[String(state.workspace.selectedMasterYear)] || { kpis: [], source: "" };
export const selectMasterYears = (state) =>
  Object.keys(state.workspace.mastersByYear).map(Number).sort((a, b) => b - a);
export const selectArchivedMasterYears = (state) =>
  Object.keys(state.workspace.archivedMastersByYear || {}).map(Number).sort((a, b) => b - a);
export const selectArchivedQuarters = (state) =>
  [...(state.workspace.archivedQuarters || [])].sort((a, b) => (b.year * 10 + b.quarter) - (a.year * 10 + a.quarter));
