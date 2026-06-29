import {
  closeDatabase,
  databaseStatus,
  getDatabase,
  getWorkspace,
  saveWorkspace
} from "../../../lib/database.js";

export {
  closeDatabase,
  databaseStatus,
  getDatabase,
  getWorkspace,
  saveWorkspace
};

export function createWorkspaceRepository() {
  return {
    get: getWorkspace,
    save: saveWorkspace
  };
}
