import { AppError } from "./errors.js";
import { isValidWorkspaceState } from "../domain/kpi.js";

export function createWorkspaceService({ workspaceRepository }) {
  return {
    async getWorkspace() {
      const workspace = await workspaceRepository.get();
      if (!workspace) {
        throw new AppError("No MongoDB workspace exists yet.", 404);
      }
      return {
        state: workspace.state,
        updatedAt: workspace.updatedAt
      };
    },
    async saveWorkspace(state) {
      if (!isValidWorkspaceState(state)) {
        throw new AppError("The KPI workspace data is invalid.", 400);
      }
      return workspaceRepository.save(state);
    }
  };
}
