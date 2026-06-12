import { createStore } from "/vendor/redux.mjs";

const REPLACE_WORKSPACE = "workspace/replace";
const SET_VIEW = "ui/setView";
const SET_SAVE_STATUS = "ui/setSaveStatus";

export function createAppStore(initialWorkspace) {
  const initialState = {
    workspace: structuredClone(initialWorkspace),
    ui: {
      view: "home",
      saveStatus: "Autosave enabled"
    }
  };

  return createStore((state = initialState, action) => {
    switch (action.type) {
      case REPLACE_WORKSPACE:
        return { ...state, workspace: structuredClone(action.payload) };
      case SET_VIEW:
        return { ...state, ui: { ...state.ui, view: action.payload } };
      case SET_SAVE_STATUS:
        return { ...state, ui: { ...state.ui, saveStatus: action.payload } };
      default:
        return state;
    }
  });
}

export const actions = {
  replaceWorkspace: (workspace) => ({ type: REPLACE_WORKSPACE, payload: workspace }),
  setView: (view) => ({ type: SET_VIEW, payload: view }),
  setSaveStatus: (status) => ({ type: SET_SAVE_STATUS, payload: status })
};

